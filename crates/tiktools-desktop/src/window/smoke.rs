//! Opt-in real main WebView transport regression. Run in its own test process
//! (`--exact window::smoke::native_main_rpc_reload`) with an isolated TIKTOOLS_HOME.
//! Do not combine with plugin native smoke: Winit allows one loop per process.
use std::sync::Arc;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::WindowId;

use super::DesktopApp;
use crate::event::{DesktopCommand, DesktopEvent};

const PAGE: &str = r#"<!doctype html><html><head><meta charset="utf-8"></head><body><script>
(() => {
  const count = 1000, expected = count + 2;
  const prefix = 'smoke-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-';
  const seen = new Uint8Array(expected), times = new Float64Array(expected);
  const began = performance.now(); let received = 0;
  const marker = pageId => window.ipc.postMessage(JSON.stringify({type:'plugin-ui-open',pluginId:'transport_smoke',pageId}));
  window.__tiktools_receive_batch__ = batch => {
    for (const raw of batch) {
      const message = JSON.parse(raw);
      if (message.type !== 'rpc-response') continue;
      const response = message.response;
      if (typeof response.id !== 'string' || !response.id.startsWith(prefix)) continue;
      const index = Number(response.id.slice(prefix.length));
      if (!Number.isInteger(index) || index < 0 || index >= expected || seen[index]) { marker('duplicate'); return; }
      if (index === count && response.error?.code !== 'too_large') { marker('oversize-error'); return; }
      if (index === count + 1 && !response.error) { marker('malformed-error'); return; }
      seen[index] = 1; times[index] = performance.now() - began; received += 1;
    }
    if (received === expected) {
      const sorted = Array.from(times).sort((a,b) => a-b);
      marker('done-' + Math.ceil(sorted[Math.floor(expected * .95)]) + '-' + Math.ceil(sorted[Math.floor(expected * .99)]));
    }
  };
  window.ipc.postMessage(JSON.stringify({type:'frontend-ready'}));
  for (let index=0; index<count; ++index) window.ipc.postMessage(JSON.stringify({jsonrpc:'2.0',id:prefix+index,method:'system.health',params:{}}));
  window.ipc.postMessage(JSON.stringify({jsonrpc:'2.0',id:prefix+count,method:'system.health',params:{blob:'x'.repeat(1024*1024)}}));
  window.ipc.postMessage('{"id":"' + prefix + (count+1) + '","method":"system.health"');
})();
</script></body></html>"#;

struct Driver {
    app: DesktopApp,
    completed: u32,
    forced_reloads: u32,
    deadline: Instant,
    failure: Option<String>,
}

impl ApplicationHandler<DesktopEvent> for Driver {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        self.app.resumed(event_loop);
    }
    fn window_event(&mut self, event_loop: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        self.app.window_event(event_loop, id, event);
    }
    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: DesktopEvent) {
        if let DesktopEvent::Command(DesktopCommand::AdmittedCommand { command, .. }) = &event {
            if let DesktopCommand::OpenPluginUi { plugin_id, page_id } = command.as_ref() {
                if plugin_id == "transport_smoke" {
                    if !page_id.starts_with("done-") {
                        self.failure = Some(format!("page transport assertion: {page_id}"));
                        event_loop.exit();
                        return;
                    }
                    self.completed += 1;
                    let health = self.app.core.system_health();
                    eprintln!(
                        "main-rpc-smoke cycle={} latency={} desktop={}",
                        self.completed, page_id, health["desktop"]
                    );
                    assert!(health["desktop"]["inboundInFlight"].as_u64().unwrap() <= 128);
                    if self.completed == 5 {
                        self.app
                            .user_event(event_loop, DesktopEvent::Command(DesktopCommand::Quit));
                    } else {
                        self.app.webview.as_ref().unwrap().reload().unwrap();
                    }
                    return;
                }
            }
        }
        let ready = matches!(
            &event,
            DesktopEvent::Command(DesktopCommand::FrontendReady { .. })
        );
        self.app.user_event(event_loop, event);
        if ready && self.forced_reloads > 0 && self.app.page_ready {
            self.forced_reloads -= 1;
            eprintln!(
                "main-rpc-smoke forcedReload remaining={} desktop={}",
                self.forced_reloads,
                self.app.core.system_health()["desktop"]
            );
            self.app.webview.as_ref().unwrap().reload().unwrap();
        }
    }
    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.app.about_to_wait(event_loop);
        if Instant::now() >= self.deadline {
            self.failure = Some(
                "main transport did not correlate all flood responses after reload".to_owned(),
            );
            event_loop.exit();
        }
        // Also bound a harness failure on Windows, where no GTK idle pump exists.
        event_loop.set_control_flow(ControlFlow::WaitUntil(
            Instant::now() + Duration::from_millis(50),
        ));
    }
}

#[test]
fn native_main_rpc_reload() {
    if std::env::var_os("TIKTOOLS_TEST_MAIN_IPC").is_none() {
        eprintln!("skipped: set TIKTOOLS_TEST_MAIN_IPC=1 and an isolated TIKTOOLS_HOME");
        return;
    }
    let home = std::path::PathBuf::from(
        std::env::var_os("TIKTOOLS_HOME").expect("main IPC smoke requires isolated TIKTOOLS_HOME"),
    );
    assert!(
        home.starts_with(std::env::temp_dir()),
        "smoke home must be inside the temporary directory"
    );
    let assets = home.join("main-smoke-assets");
    std::fs::create_dir_all(&assets).unwrap();
    let script = PAGE
        .split_once("<script>")
        .unwrap()
        .1
        .split_once("</script>")
        .unwrap()
        .0;
    std::fs::write(assets.join("index.html"), r#"<!doctype html><html><head><meta charset="utf-8"></head><body><script src="./probe.js"></script></body></html>"#).unwrap();
    std::fs::write(assets.join("probe.js"), script).unwrap();
    crate::platform::initialize().unwrap();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let mut builder = EventLoop::<DesktopEvent>::with_user_event();
    #[cfg(target_os = "linux")]
    {
        use winit::platform::x11::EventLoopBuilderExtX11;
        builder.with_any_thread(true);
    }
    crate::platform::configure_event_loop(&mut builder);
    let event_loop = builder.build().unwrap();
    let proxy = event_loop.create_proxy();
    let emitter = crate::event::shared_emitter(proxy.clone());
    let core = Arc::new(tiktools_core::AppCore::new(emitter.clone()));
    let router = Arc::new(tiktools_core::ipc::IpcRouter::new(core.clone()));
    let app = DesktopApp::new(
        core,
        router,
        crate::webview::FrontendSource::EmbeddedAssets {
            root: Arc::new(assets),
        },
        runtime.handle().clone(),
        proxy,
        home.join("main-smoke.log"),
        emitter,
    );
    let mut driver = Driver {
        app,
        completed: 0,
        forced_reloads: 5,
        deadline: Instant::now() + Duration::from_secs(90),
        failure: None,
    };
    event_loop.run_app(&mut driver).unwrap();
    assert_eq!(driver.completed, 5, "{:?}", driver.failure);
    assert!(driver.failure.is_none());
    assert_eq!(driver.app.emitter.ipc_slots.available_permits(), 128);
}
