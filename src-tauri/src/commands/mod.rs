pub mod terminal;
pub mod claude_data;
pub mod projects;
pub mod skills;
pub mod github;
pub mod settings;

/// Extension trait to suppress console windows on Windows GUI apps.
/// On non-Windows platforms this is a no-op.
pub trait CommandNoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl CommandNoWindow for std::process::Command {
    #[cfg(windows)]
    fn no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        self.creation_flags(CREATE_NO_WINDOW)
    }

    #[cfg(not(windows))]
    fn no_window(&mut self) -> &mut Self {
        self
    }
}
