// WebSocket protocol between MCP server and Chrome extension

export type ServerCommand =
  | { type: "capture_page"; id: string }
  | { type: "start_network_capture"; id: string }
  | { type: "stop_network_capture"; id: string }
  | { type: "get_console_logs"; id: string }
  | { type: "get_dom_snapshot"; id: string; maxDepth?: number }
  | { type: "detect_framework"; id: string }
  | { type: "take_screenshot"; id: string }
  | { type: "get_active_tab"; id: string }
  | { type: "ping"; id: string }
  // Browser interaction commands
  | { type: "browser_navigate"; id: string; url: string }
  | { type: "browser_click"; id: string; selector: string }
  | { type: "browser_type"; id: string; selector: string; text: string; clearFirst?: boolean }
  | { type: "browser_press_key"; id: string; key: string }
  | { type: "browser_hover"; id: string; selector: string }
  | { type: "browser_select_option"; id: string; selector: string; value: string }
  | { type: "browser_wait"; id: string; seconds: number }
  // AI orchestration commands (zero human intervention)
  | { type: "connect_tab"; id: string; url?: string; tabId?: number }
  | { type: "disconnect_tab"; id: string }
  | { type: "list_tabs"; id: string }
  | { type: "get_connection_status"; id: string }
  | { type: "reconnect_tab"; id: string }
  | { type: "get_capabilities"; id: string }
  // Cookie & storage commands (AC-4, AC-5)
  | { type: "get_cookies"; id: string }
  | { type: "set_cookie"; id: string; [key: string]: unknown }
  | { type: "delete_cookies"; id: string; [key: string]: unknown }
  | { type: "get_storage"; id: string; [key: string]: unknown }
  | { type: "set_storage"; id: string; [key: string]: unknown }
  | { type: "clear_storage"; id: string; [key: string]: unknown }
  // Dialog commands (AC-6)
  | { type: "get_dialog"; id: string }
  | { type: "handle_dialog"; id: string; [key: string]: unknown }
  // Response body (AC-7)
  | { type: "get_response_body"; id: string; [key: string]: unknown }
  // Viewport & emulation (AC-8)
  | { type: "set_viewport"; id: string; [key: string]: unknown }
  | { type: "set_user_agent"; id: string; [key: string]: unknown }
  | { type: "emulate_device"; id: string; [key: string]: unknown }
  // PDF (AC-9)
  | { type: "print_to_pdf"; id: string; [key: string]: unknown }
  // Advanced input (AC-10)
  | { type: "browser_scroll"; id: string; [key: string]: unknown }
  | { type: "browser_double_click"; id: string; [key: string]: unknown }
  | { type: "browser_drag"; id: string; [key: string]: unknown }
  // File upload (AC-11)
  | { type: "browser_file_upload"; id: string; [key: string]: unknown }
  // Geolocation (AC-12)
  | { type: "set_geolocation"; id: string; [key: string]: unknown }
  // Accessibility (AC-13)
  | { type: "get_accessibility_tree"; id: string; [key: string]: unknown }
  // Performance (AC-14)
  | { type: "get_performance_metrics"; id: string }
  // Stealth (AC-15)
  | { type: "set_stealth_mode"; id: string; [key: string]: unknown }
  // WebSocket monitoring (AC-16)
  | { type: "get_websocket_connections"; id: string; [key: string]: unknown }
  | { type: "get_websocket_messages"; id: string; [key: string]: unknown }
  // Network conditions (AC-17)
  | { type: "emulate_network"; id: string; [key: string]: unknown }
  | { type: "set_cache_disabled"; id: string; [key: string]: unknown }
  | { type: "set_extra_headers"; id: string; [key: string]: unknown }
  // Security (AC-18)
  | { type: "get_security_state"; id: string }
  | { type: "ignore_certificate_errors"; id: string; [key: string]: unknown }
  // Service workers (AC-19)
  | { type: "list_service_workers"; id: string }
  | { type: "stop_service_worker"; id: string; [key: string]: unknown }
  | { type: "bypass_service_worker"; id: string; [key: string]: unknown }
  // DOM mutation (AC-20)
  | { type: "set_outer_html"; id: string; [key: string]: unknown }
  | { type: "set_attribute"; id: string; [key: string]: unknown }
  | { type: "remove_attribute"; id: string; [key: string]: unknown }
  | { type: "remove_node"; id: string; [key: string]: unknown }
  // CSS/JS coverage (AC-21)
  | { type: "start_css_coverage"; id: string }
  | { type: "stop_css_coverage"; id: string }
  | { type: "start_js_coverage"; id: string; [key: string]: unknown }
  | { type: "stop_js_coverage"; id: string }
  // Computed style, pseudo state & font detection (AC-22)
  | { type: "get_computed_style"; id: string; [key: string]: unknown }
  | { type: "force_pseudo_state"; id: string; [key: string]: unknown }
  | { type: "detect_fonts"; id: string; [key: string]: unknown }
  // IndexedDB (AC-23)
  | { type: "get_databases"; id: string }
  | { type: "query_object_store"; id: string; [key: string]: unknown }
  | { type: "clear_database"; id: string; [key: string]: unknown }
  // Targets (AC-24)
  | { type: "get_targets"; id: string }
  | { type: "attach_to_target"; id: string; [key: string]: unknown }
  | { type: "create_browser_context"; id: string; [key: string]: unknown }
  // Memory & heap (AC-25)
  | { type: "get_dom_counters"; id: string }
  | { type: "force_gc"; id: string }
  | { type: "take_heap_snapshot"; id: string }
  // Overlay & visual debug (AC-26)
  | { type: "highlight_element"; id: string; [key: string]: unknown }
  | { type: "show_layout_shifts"; id: string; [key: string]: unknown }
  | { type: "show_paint_rects"; id: string; [key: string]: unknown }
  // Selector wait (AC-1)
  | { type: "wait_for_selector"; id: string; [key: string]: unknown }
  | { type: "browser_wait_for"; id: string; [key: string]: unknown }
  // Frame commands (AC-2)
  | { type: "get_frame_tree"; id: string }
  | { type: "switch_to_frame"; id: string; frameId: string }
  | { type: "switch_to_main_frame"; id: string }
  // Tab management (AC-3)
  | { type: "create_tab"; id: string; [key: string]: unknown }
  | { type: "close_tab"; id: string; tabId: number }
  | { type: "switch_tab"; id: string; tabId: number }
  // Network intercept (AC-7)
  | { type: "browser_intercept"; id: string; [key: string]: unknown }
  // Network replay (PiecesOS Heist Ph3)
  | { type: "replay_request"; id: string; [key: string]: unknown }
  // Crawlio server commands
  | { type: "extract_site"; id: string; [key: string]: unknown }
  | { type: "get_crawl_status"; id: string; [key: string]: unknown }
  | { type: "get_enrichment"; id: string; [key: string]: unknown }
  | { type: "get_crawled_urls"; id: string; [key: string]: unknown }
  | { type: "enrich_url"; id: string; [key: string]: unknown }
  // Code execution
  | { type: "execute_code"; id: string; [key: string]: unknown }
  // JS evaluation (MCP hardening — browser_evaluate via CDP Runtime.evaluate)
  | { type: "browser_evaluate"; id: string; expression: string }
  // Batch form fill (via refs from browser_snapshot)
  | { type: "browser_fill_form"; id: string; fields: Array<{ ref: string; type?: string; value: string }> }
  // Accessibility snapshot (via CDP Accessibility.getFullAXTree)
  | { type: "browser_snapshot"; id: string }
  // Session recording
  | { type: "start_recording"; id: string; maxDurationSec?: number; maxInteractions?: number }
  | { type: "stop_recording"; id: string }
  | { type: "get_recording_status"; id: string };

export type ExtensionResponse =
  | { type: "response"; id: string; success: true; data: unknown }
  | { type: "response"; id: string; success: false; error: string }
  | { type: "connected"; extensionId: string }
  | { type: "pong"; id: string }
  | { type: "refresh_port" }
  | { type: "open_crawlio_app" };

export type WireMessage = ServerCommand | ExtensionResponse;
