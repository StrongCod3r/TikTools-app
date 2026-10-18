//! Observer integration: the real backend binary receives a framed
//! `live.ui-event` chat delivery and POSTs speech to the configured
//! server. A std-only TCP stub stands in for the SonicBoom server so no
//! test-only HTTP dependency leaks into the package.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::Stdio;
use std::sync::mpsc;
use std::time::Duration;

fn frame(value: &serde_json::Value) -> Vec<u8> {
    let body = serde_json::to_vec(value).unwrap();
    let mut out = (body.len() as u32).to_le_bytes().to_vec();
    out.extend_from_slice(&body);
    out
}

fn read_frame(stdout: &mut std::process::ChildStdout) -> serde_json::Value {
    let mut len = [0_u8; 4];
    stdout.read_exact(&mut len).unwrap();
    let len = u32::from_le_bytes(len) as usize;
    let mut body = vec![0_u8; len];
    stdout.read_exact(&mut body).unwrap();
    serde_json::from_slice(&body).unwrap()
}

/// Minimal HTTP/1.1 stub: answers `GET /api/tts/plugin/voices` and records
/// `POST /api/tts/play` requests, then reports them over the channel.
fn stub_server(listener: TcpListener, report: mpsc::Sender<(String, String)>) {
    for stream in listener.incoming().take(4) {
        let Ok(mut stream) = stream else { break };
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut raw = Vec::new();
        let mut chunk = [0_u8; 4096];
        // Read until the header terminator, then the declared body.
        while let Ok(read) = stream.read(&mut chunk) {
            if read == 0 {
                break;
            }
            raw.extend_from_slice(&chunk[..read]);
            if raw.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        let text = String::from_utf8_lossy(&raw).into_owned();
        let Some(header_end) = text.find("\r\n\r\n") else {
            break;
        };
        let head = &text[..header_end];
        let mut lines = head.lines();
        let request_line = lines.next().unwrap_or_default().to_owned();
        let content_length: usize = lines
            .filter_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.trim().eq_ignore_ascii_case("content-length") {
                    value.trim().parse().ok()
                } else {
                    None
                }
            })
            .next()
            .unwrap_or(0);
        let mut body = text
            .as_bytes()
            .get(header_end + 4..)
            .unwrap_or_default()
            .to_vec();
        while body.len() < content_length {
            let Ok(read) = stream.read(&mut chunk) else {
                break;
            };
            if read == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..read]);
        }
        if request_line.starts_with("GET /api/tts/plugin/voices") {
            let payload = r#"[{"id":"supertonic:M1","name":"M1"}]"#;
            let _ = stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                    payload.len()
                )
                .as_bytes(),
            );
        } else if request_line.starts_with("POST /api/tts/play") {
            let _ = report.send((request_line, String::from_utf8_lossy(&body).into_owned()));
            let payload = r#"{"ok":true}"#;
            let _ = stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                    payload.len()
                )
                .as_bytes(),
            );
        } else {
            let _ = stream.write_all(
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
        }
    }
}

#[test]
fn chat_event_speaks_through_the_configured_server() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (report, received) = mpsc::channel();
    let server = std::thread::spawn(move || stub_server(listener, report));

    let root = std::env::temp_dir().join(format!("sonicboom-observer-test-{}", std::process::id()));
    let plugin_dir = root.join("sonicboom.server");
    std::fs::create_dir_all(&plugin_dir).unwrap();
    std::fs::write(
        plugin_dir.join("settings.json"),
        serde_json::json!({
            "serverUrl": format!("http://127.0.0.1:{port}"),
            "apiToken": "",
            "tts": {
                "enabled": true,
                "allowAllUsers": true,
                "commentMode": "any",
                "defaultVoice": "M1",
                "language": "en",
            },
        })
        .to_string(),
    )
    .unwrap();

    let binary = env!("CARGO_BIN_EXE_sonicboom-backend");
    let mut child = std::process::Command::new(binary)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("TIKTOOLS_PLUGIN_ID", "sonicboom.server")
        .env("TIKTOOLS_PLUGIN_DATA_DIR", &root)
        .env("TIKTOOLS_PLUGIN_DIRECTORY", &plugin_dir)
        .spawn()
        .unwrap();

    let request = serde_json::json!({
        "protocolVersion": 1,
        "id": "observer-1",
        "method": "call",
        "payload": {
            "type": "event",
            "event": {
                "topic": "live.ui-event",
                "data": {
                    "event": {
                        "kind": "chat",
                        "author": "ada",
                        "nickname": "Ada",
                        "text": "hello world",
                    },
                },
            },
        },
    });
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&frame(&request))
        .unwrap();
    let response = read_frame(child.stdout.as_mut().unwrap());
    assert_eq!(response["ok"], true);
    assert_eq!(response["id"], "observer-1");

    let (request_line, body) = received
        .recv_timeout(Duration::from_secs(20))
        .expect("backend must POST speech to the server");
    assert!(
        request_line.contains("provider=supertonic")
            && request_line.contains("voice=supertonic%3AM1")
            && request_line.contains("lang=en"),
        "speech URL carries voice/lang: {request_line}"
    );
    assert_eq!(body, "hello world");

    // A replay of the same line inside the dedup window must not speak.
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&frame(&request))
        .unwrap();
    let response = read_frame(child.stdout.as_mut().unwrap());
    assert_eq!(response["ok"], true);
    assert!(
        received.recv_timeout(Duration::from_millis(500)).is_err(),
        "replayed chat must not speak twice"
    );

    let _ = child.kill();
    let _ = child.wait();
    let _ = std::fs::remove_dir_all(&root);
    drop(server);
}

#[test]
fn cloned_providers_cross_process_boundary_and_reach_playback_queue() {
    for (provider, special_override) in [
        ("pocket-tts", false),
        ("qwen3-gguf", false),
        ("pocket-tts", true),
        ("qwen3-gguf", true),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (report, received) = mpsc::channel();
        let server = std::thread::spawn(move || {
            for index in 0..3 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut raw = Vec::new();
                let mut chunk = [0; 4096];
                loop {
                    let n = stream.read(&mut chunk).unwrap();
                    raw.extend_from_slice(&chunk[..n]);
                    if n == 0 || raw.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&raw).to_string();
                let payload = match index {
                    0 => format!(r#"[{{"id":"{provider}:owned-profile"}}]"#),
                    1 => r#"{"id":"synthesis-a","stage":"queued"}"#.to_string(),
                    _ => r#"{"id":"synthesis-a","stage":"completed","playback":{"state":"queued","queue_id":"playback-a"}}"#.to_string(),
                };
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}", payload.len()).unwrap();
                report.send(request).unwrap();
            }
        });
        let root =
            std::env::temp_dir().join(format!("sonicboom-jobs-{}-{provider}", std::process::id()));
        let plugin_dir = root.join("sonicboom.server");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(plugin_dir.join("settings.json"), serde_json::json!({
            "serverUrl": format!("http://{address}"), "apiToken":"owner-token",
            "tts": {"enabled":true,"providerId":if special_override {"supertonic"} else {provider},"defaultVoice":if special_override {"supertonic:M1".to_owned()} else {format!("{provider}:owned-profile")},"language":"es",
                "specialUsers":if special_override {serde_json::json!([{"handle":"ada","allowed":true,"providerId":provider,"voice":format!("{provider}:owned-profile")}])} else {serde_json::json!([])}}
        }).to_string()).unwrap();
        let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_sonicboom-backend"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("TIKTOOLS_PLUGIN_ID", "sonicboom.server")
            .env("TIKTOOLS_PLUGIN_DATA_DIR", &root)
            .env("TIKTOOLS_PLUGIN_DIRECTORY", &plugin_dir)
            .spawn()
            .unwrap();
        let request = serde_json::json!({"protocolVersion":1,"id":"chat-1","method":"call","payload":{"type":"event","event":{"topic":"live.ui-event","data":{"event":{"kind":"chat","author":"ada","text":"hola","msgId":"upstream-1"}}}}});
        child
            .stdin
            .as_mut()
            .unwrap()
            .write_all(&frame(&request))
            .unwrap();
        assert_eq!(read_frame(child.stdout.as_mut().unwrap())["ok"], true);
        let requests: Vec<_> = (0..3)
            .map(|_| received.recv_timeout(Duration::from_secs(10)).unwrap())
            .collect();
        assert!(requests[1].starts_with(&format!("POST /api/tts/jobs?profile=owned-profile&provider={provider}&lang=es&format=wav&playback=enqueue&play_now=false ")));
        assert!(requests[1]
            .to_lowercase()
            .contains("authorization: bearer owner-token"));
        assert!(requests[1]
            .to_lowercase()
            .contains("idempotency-key: tiktools-"));
        assert!(requests[2].starts_with("GET /api/tts/jobs/synthesis-a "));
        server.join().unwrap();
        for _ in 0..100 {
            child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(&frame(&request))
                .unwrap();
            assert_eq!(read_frame(child.stdout.as_mut().unwrap())["ok"], true);
        }
        // EOF performs a graceful plugin shutdown and joins tracking tasks.
        drop(child.stdin.take());
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("playback=queued queue_id=playback-a")
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn live_burst_is_nonblocking_during_generation_and_disconnect_cancels() {
    for topic in [
        Some("live.disconnected"),
        Some("plugin.settings-changed"),
        None,
    ] {
        burst_cancel_case(topic);
    }
}

fn burst_cancel_case(cancellation_topic: Option<&str>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (report, received) = mpsc::channel();
    let server = std::thread::spawn(move || loop {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut buffer = [0; 8192];
        let n = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..n]);
        let line = request.lines().next().unwrap().to_owned();
        let payload = if line.starts_with("GET /api/tts/plugin/voices ") {
            r#"[{"id":"qwen3-gguf:profile"}]"#
        } else if line.starts_with("POST /api/tts/jobs?") {
            r#"{"id":"slow-job","stage":"queued"}"#
        } else if line.contains("/cancel") {
            r#"{"id":"slow-job","stage":"cancelled"}"#
        } else {
            r#"{"id":"slow-job","stage":"running"}"#
        };
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{payload}", payload.len()).unwrap();
        let done = line.contains("/cancel");
        report.send(line).unwrap();
        if done {
            break;
        }
    });
    let root = std::env::temp_dir().join(format!("sonicboom-burst-{}", std::process::id()));
    let plugin_dir = root.join("sonicboom.server");
    std::fs::create_dir_all(&plugin_dir).unwrap();
    std::fs::write(plugin_dir.join("settings.json"), serde_json::json!({
        "serverUrl":format!("http://{address}"),"tts":{"enabled":true,"providerId":"qwen3-gguf","defaultVoice":"qwen3-gguf:profile","chatMaxInflight":1}
    }).to_string()).unwrap();
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_sonicboom-backend"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("TIKTOOLS_PLUGIN_ID", "sonicboom.server")
        .env("TIKTOOLS_PLUGIN_DATA_DIR", &root)
        .env("TIKTOOLS_PLUGIN_DIRECTORY", &plugin_dir)
        .spawn()
        .unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let stderr_reader = std::thread::spawn(move || {
        let mut diagnostics = String::new();
        stderr.read_to_string(&mut diagnostics).unwrap();
        diagnostics
    });
    let send = |child: &mut std::process::Child, topic: &str, data: serde_json::Value| {
        child.stdin.as_mut().unwrap().write_all(&frame(&serde_json::json!({"protocolVersion":1,"id":"event","method":"call","payload":{"type":"event","event":{"topic":topic,"data":data}}}))).unwrap();
        assert_eq!(read_frame(child.stdout.as_mut().unwrap())["ok"], true);
    };
    send(
        &mut child,
        "live.ui-event",
        serde_json::json!({"event":{"kind":"chat","text":"first","msgId":"first"}}),
    );
    for _ in 0..3 {
        received.recv_timeout(Duration::from_secs(5)).unwrap();
    }
    let start = std::time::Instant::now();
    for index in 0..100 {
        send(
            &mut child,
            "live.ui-event",
            serde_json::json!({"event":{"kind":"chat","text":"message","msgId":index}}),
        );
    }
    assert!(
        start.elapsed() < Duration::from_secs(2),
        "generation must not block LIVE acknowledgements"
    );
    if let Some(topic) = cancellation_topic {
        send(
            &mut child,
            topic,
            serde_json::json!({"pluginId":"sonicboom.server"}),
        );
    } else {
        drop(child.stdin.take());
    }
    loop {
        if received
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .contains("/cancel")
        {
            break;
        }
    }
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let diagnostics = stderr_reader.join().unwrap();
    assert_eq!(
        diagnostics
            .matches(" submitted synthesis_id=slow-job")
            .count(),
        1
    );
    assert!(diagnostics.contains("observed=101"));
    let totals = diagnostics
        .lines()
        .find(|line| line.starts_with("sonicboom: totals "))
        .unwrap();
    let count = |key: &str| {
        totals
            .split_whitespace()
            .find_map(|part| part.strip_prefix(&format!("{key}=")))
            .unwrap()
            .parse::<u64>()
            .unwrap()
    };
    let terminal: u64 = [
        "accepted",
        "failed",
        "expired",
        "rejected",
        "deduped",
        "filtered",
        "cancelled",
    ]
    .iter()
    .map(|key| count(key))
    .sum();
    assert_eq!(
        terminal, 101,
        "every observed message has a terminal outcome: {totals}"
    );
    server.join().unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
