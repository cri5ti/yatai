//! Is a process still running, and since when. Shared by the session sources (Claude, Copilot).

/// The process's creation time (a Windows FILETIME: 100 ns ticks since 1601), or None when `pid` is not running.
/// Elsewhere there is no cheap equivalent: Some(0) when the process exists, None when not.
#[cfg(windows)]
pub fn started(pid: u32) -> Option<u64> {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut code = 0u32;
        let running = GetExitCodeProcess(h, &mut code) != 0 && code == 259; // STILL_ACTIVE
        let z = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let (mut created, mut a, mut b, mut c) = (z, z, z, z);
        let ok = GetProcessTimes(h, &mut created, &mut a, &mut b, &mut c) != 0;
        CloseHandle(h);
        (running && ok).then(|| (created.dwHighDateTime as u64) << 32 | created.dwLowDateTime as u64)
    }
}

#[cfg(not(windows))]
pub fn started(pid: u32) -> Option<u64> {
    std::process::Command::new("kill").args(["-0", &pid.to_string()]).output().ok().filter(|o| o.status.success()).map(|_| 0)
}

/// FILETIME ticks → milliseconds since the Unix epoch
pub fn filetime_ms(t: u64) -> u64 {
    (t / 10_000).saturating_sub(11_644_473_600_000)
}
