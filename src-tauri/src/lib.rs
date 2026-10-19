pub mod load_deck;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_deck::parse_clipboard_table,
            load_deck::build_load_deck,
            load_deck::export_load_bundle,
            load_deck::export_output_file,
        ])
        .run(tauri::generate_context!())
        .expect("LoadCreator 启动失败");
}
