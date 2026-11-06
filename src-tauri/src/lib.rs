#![allow(clippy::result_large_err)]

pub mod commands;
pub mod core;
pub mod load_deck;
pub mod modules;
pub mod solvers;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            // Legacy tabular pipeline (preserved for compatibility).
            load_deck::parse_clipboard_table,
            load_deck::build_load_deck,
            load_deck::export_load_bundle,
            load_deck::export_output_file,
            // 2.0 case workbench.
            commands::case::list_case_modules,
            commands::case::validate_case,
            commands::case::preview_case,
            commands::case::build_case,
            commands::project::save_project,
            commands::project::open_project,
            commands::project::migrate_legacy_workspace_cmd,
            commands::export::export_case_files,
        ])
        .run(tauri::generate_context!())
        .expect("LoadCreator 启动失败");
}
