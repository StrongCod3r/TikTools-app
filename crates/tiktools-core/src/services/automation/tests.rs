//! Automation service unit tests.

use super::*;
use serde_json::json;

#[test]
fn enriched_intel_paths_match_generic_filters() {
    let service = AutomationService::default();
    let record = json!({
        "id": "event",
        "enabled": true,
        "trigger": "tiktok.chat",
        "filters": [
            {"path": "event.intel.comment.composition.emojiOnly", "operator": "is-true"},
            {"path": "event.intel.comment.spam.score", "operator": "lt", "value": "0.70"},
            {"path": "event.intel.comment.language.top", "operator": "eq", "value": "es"},
        ],
    });
    let matching = json!({
        "type": "tiktok.chat",
        "user": {"uniqueId": "alice"},
        "data": {"comment": "😂😂😂"},
        "intel": {"comment": {
            "composition": {"emojiOnly": true},
            "spam": {"score": 0.04},
            "language": {"top": "es", "confidence": 0.9},
        }},
    });
    assert!(service.event_record_matches(&record, &matching));
    // Raw events without enrichment never match intel filters.
    let raw = json!({
        "type": "tiktok.chat",
        "user": {"uniqueId": "alice"},
        "data": {"comment": "😂😂😂"},
    });
    assert!(!service.event_record_matches(&record, &raw));
    // Score above the threshold fails the numeric filter.
    let spammy = json!({
        "type": "tiktok.chat",
        "user": {"uniqueId": "alice"},
        "data": {"comment": "buy now"},
        "intel": {"comment": {
            "composition": {"emojiOnly": true},
            "spam": {"score": 0.91},
            "language": {"top": "es", "confidence": 0.9},
        }},
    });
    assert!(!service.event_record_matches(&record, &spammy));
}

#[test]
fn matches_filters_and_enforces_user_cooldowns() {
    let service = AutomationService::default();
    service.replace_snapshot(&json!({
        "actions": [{"id":"action","enabled":true}],
        "events": [{
            "id":"event","enabled":true,"trigger":"tiktok.chat",
            "filters":[{"path":"event.data.comment","operator":"contains","value":"hello"}],
            "cooldownMs":1000,"cooldownScope":"user","actionIds":["action"]
        }]
    }));
    let event =
        json!({"type":"tiktok.chat","user":{"uniqueId":"alice"},"data":{"comment":"Hello there"}});
    let record = service
        .matching_events(&event)
        .pop()
        .expect("event should match");
    assert!(service.claim_event(&record, &event, 100));
    assert!(!service.claim_event(&record, &event, 500));
    assert!(service.claim_event(&record, &event, 1_100));
    assert_eq!(service.actions_for_event(&record).len(), 1);
}
#[test]
fn plugin_triggers_match_only_while_their_plugin_is_active() {
    let service = AutomationService::default();
    service.replace_snapshot(&json!({
        "actions": [{"id":"action","enabled":true}],
        "events": [{
            "id":"event","enabled":true,"trigger":"hotkey.pressed",
            "filters":[{"path":"event.data.key","operator":"eq","value":"ctrl+k"}],
            "cooldownMs":0,"cooldownScope":"user","actionIds":["action"]
        }],
        "eventTypes": [{
            "type":"hotkey.pressed","title":{"default":"Hotkey pressed"},
            "source":{"kind":"plugin","pluginId":"hotkeys"}
        }],
        "plugins": [{
            "descriptor":{"id":"hotkeys"},"installed":true,"enabled":true,"available":true
        }]
    }));
    let event =
        json!({"type":"hotkey.pressed","user":{"uniqueId":"alice"},"data":{"key":"ctrl+k"}});
    assert_eq!(service.matching_events(&event).len(), 1);

    // Disabled plugin pauses its triggers; built-ins keep matching.
    service.replace_snapshot(&json!({
        "actions": [{"id":"action","enabled":true}],
        "events": [
            {"id":"event","enabled":true,"trigger":"hotkey.pressed","filters":[],"actionIds":["action"]},
            {"id":"builtin","enabled":true,"trigger":"tiktok.chat","filters":[],"actionIds":["action"]}
        ],
        "eventTypes": [{
            "type":"hotkey.pressed","title":{"default":"Hotkey pressed"},
            "source":{"kind":"plugin","pluginId":"hotkeys"}
        }],
        "plugins": [{
            "descriptor":{"id":"hotkeys"},"installed":true,"enabled":false,"available":true
        }]
    }));
    assert!(service.matching_events(&event).is_empty());
    let chat = json!({"type":"tiktok.chat","user":{"uniqueId":"alice"},"data":{}});
    assert_eq!(service.matching_events(&chat).len(), 1);
}

#[test]
fn poll_responses_keep_only_declared_typed_events() {
    let declared = vec!["hotkey.pressed".to_owned()];
    let response = tiktools_plugin_sdk::decode_plugin_result(json!({"events": [
        {"type": "hotkey.pressed", "data": {"key": "ctrl+k"}},
        {"type": "tiktok.chat", "data": {}},
        {"type": "hotkey.pressed", "data": "nope"},
        {"type": "other.thing", "data": {}},
    ]}))
    .unwrap();
    let parsed = crate::parse_polled_events(&declared, &response);
    assert_eq!(parsed.events.len(), 1);
    assert_eq!(parsed.events[0].0, "hotkey.pressed");
    assert_eq!(parsed.events[0].1, json!({"key": "ctrl+k"}));
    assert_eq!(parsed.undeclared, 2);
    assert_eq!(parsed.invalid, 1);
    assert_eq!(parsed.truncated, 0);

    // Oversized payloads are dropped.
    let big = "x".repeat(70 * 1024);
    let response = tiktools_plugin_sdk::decode_plugin_result(
        json!({"events": [{"type": "hotkey.pressed", "data": {"blob": big}}]}),
    )
    .unwrap();
    let parsed = crate::parse_polled_events(&declared, &response);
    assert!(parsed.events.is_empty());
    assert_eq!(parsed.invalid, 1);
}

#[test]
fn cooldown_tracking_stays_bounded_without_changing_decisions() {
    let service = AutomationService::default();
    let record = json!({
        "id": "event", "enabled": true, "trigger": "tiktok.chat",
        "filters": [], "cooldownMs": 1_000, "cooldownScope": "user",
        "actionIds": [],
    });
    // One claim per distinct viewer: attacker-controlled cardinality.
    for id in 0..9_000 {
        let event = json!({"type": "tiktok.chat", "user": {"uniqueId": format!("viewer-{id}")}});
        assert!(service.claim_event(&record, &event, 1_000));
    }
    let retained = service
        .cooldowns
        .lock()
        .map(|map| map.len())
        .unwrap_or(usize::MAX);
    assert!(
        retained <= 8_192,
        "cooldown map must stay bounded, got {retained}"
    );
    // Recent keys still decide correctly after the amortized sweeps.
    let recent = json!({"type": "tiktok.chat", "user": {"uniqueId": "viewer-8999"}});
    assert!(!service.claim_event(&record, &recent, 1_500));
    assert!(service.claim_event(&record, &recent, 2_001));
}

#[test]
fn stale_records_are_not_live_after_disable_or_remove() {
    let service = AutomationService::default();
    let snapshot = |enabled: bool| {
        json!({
            "actions": [{"id": "action", "enabled": true}],
            "events": [{
                "id": "event", "enabled": enabled, "trigger": "tiktok.chat",
                "filters": [], "actionIds": ["action"],
            }],
        })
    };
    service.replace_snapshot(&snapshot(true));
    let event = json!({"type": "tiktok.chat", "user": {"uniqueId": "alice"}});
    let record = service
        .matching_events(&event)
        .pop()
        .expect("record matches while enabled");
    assert!(service.is_record_live(&record));
    // Disabled between match and execution: stale, must not execute.
    service.replace_snapshot(&snapshot(false));
    assert!(!service.is_record_live(&record));
    // Removed entirely: stale as well.
    service.replace_snapshot(&json!({"actions": [], "events": []}));
    assert!(!service.is_record_live(&record));
    // Records without identity never execute.
    assert!(!service.is_record_live(&json!({"enabled": true})));
}
