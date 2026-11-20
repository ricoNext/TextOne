// Release builds hide the console window; debug keeps it for logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    textone_lib::run()
}
