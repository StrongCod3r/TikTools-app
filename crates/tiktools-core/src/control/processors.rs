//! Event processor testing and status operations.

use super::{clean_plugin_id, OperationError};
use crate::*;
use serde::Deserialize;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProcessorOutcomeDto {
    pub plugin_id: String,
    pub processor_id: String,
    pub ok: bool,
    pub duration_ms: u64,
    pub result: Value,
    pub error: Option<String>,
}

impl AppCore {
    // ------------------------------------------------------------------
    // Processors.
    // ------------------------------------------------------------------

    pub async fn processor_test(
        &self,
        plugin_id: &str,
        processor_id: &str,
        event: Value,
    ) -> Result<ProcessorOutcomeDto, OperationError> {
        let plugin_id = clean_plugin_id(plugin_id)?;
        let processor_id = processor_id.trim();
        if processor_id.is_empty() || processor_id.len() > 128 {
            return Err(OperationError::invalid(
                "processor id must be 1..=128 characters",
            ));
        }
        if !event.is_object() {
            return Err(OperationError::invalid("event must be an object"));
        }
        let outcome = self.test_processor(&plugin_id, processor_id, event).await;
        Ok(ProcessorOutcomeDto {
            plugin_id,
            processor_id: processor_id.to_owned(),
            ok: outcome.ok,
            duration_ms: outcome.duration_ms,
            result: outcome.result,
            error: outcome.error,
        })
    }

    pub fn processor_status(&self) -> Value {
        self.processor_status_snapshot()
    }

    pub fn processor_list(&self) -> Vec<Value> {
        match self.processor_status_snapshot() {
            Value::Array(entries) => entries,
            snapshot => snapshot
                .get("processors")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        }
    }

    /// Low-overhead aggregate over the per-processor metrics map: one lock,
    /// numeric sums only, no per-processor serialization. Feeds the
    /// `processorStats` health object (calls, successes, failures,
    /// timeouts, overloaded sheds, summed success latency).
    pub(crate) fn processor_totals(&self) -> (u64, u64, u64, u64, u64, u64) {
        let metrics = recover_mutex(&self.processor_state.metrics, "processor metrics");
        let mut totals = (0u64, 0u64, 0u64, 0u64, 0u64, 0u64);
        for metric in metrics.values() {
            totals.0 = totals.0.saturating_add(metric.calls);
            totals.1 = totals.1.saturating_add(metric.successes);
            totals.2 = totals.2.saturating_add(metric.failures);
            totals.3 = totals.3.saturating_add(metric.timeouts);
            totals.4 = totals.4.saturating_add(metric.skipped_overloaded);
            totals.5 = totals.5.saturating_add(metric.total_latency_ms);
        }
        totals
    }
}
