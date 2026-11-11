# yatai: read the unread mail of the local (classic) Outlook through COM. Read-only. Only the user's own mailbox
# (no shared ones), only the folders they picked (Settings -> Emails), never the system folders.
# In (stdin, JSON), one of:
#   { "mode": "folders" }  -> { "inbox": "<path>", "folders": [ { path, depth, unread } ] }  the mail folders to pick from
#   { "days": 14, "limit": 200, "known": ["<EntryID>", ...], "folders": ["Inbox", "Inbox\Team", ...] }
#     -> { "me": "<name>", "missing": [paths], "items": [ { id, folder, conv, received, from, fromAddr, to, cc, subject, unread, importance, attach, body? } ] }
#     the unread mail of those folders (none given: nothing) received in the last `days` days (0 = any age), newest
#     first, at most `limit` in all. `body` (the first 2000 characters of the plain text) only for ids not in `known`.
# Errors: { "error": "…" }. Folder paths are relative to the mailbox, separated by backslashes.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$in = [Console]::In.ReadToEnd() | ConvertFrom-Json
$limit = if ($in.limit) { [int]$in.limit } else { 200 }
$cutoff = if ($in.days -gt 0) { [DateTime]::UtcNow.AddDays(-[double]$in.days) } else { $null }
$known = @{}
foreach ($k in @($in.known)) { if ($k) { $known[$k] = $true } }

try {
$ol = New-Object -ComObject Outlook.Application
$ns = $ol.GetNamespace('MAPI')
$inbox = $ns.GetDefaultFolder(6) # olFolderInbox
$root = $inbox.Store.GetRootFolder() # the user's own mailbox only
# system folders (and everything under them): deleted, outbox, sent, drafts, junk, conflicts, sync issues, failures, RSS
$skip = @{}
foreach ($id in 3, 4, 5, 16, 19, 20, 21, 22, 23, 25) { try { $skip[$ns.GetDefaultFolder($id).EntryID] = $true } catch {} }
$prefix = $root.FolderPath + '\'
function Rel($f) { $p = $f.FolderPath; if ($p.StartsWith($prefix)) { $p.Substring($prefix.Length) } else { $f.Name } }
function Skip($f) { $skip.ContainsKey($f.EntryID) -or $f.DefaultItemType -ne 0 -or $f.Name -eq 'Conversation History' }

if ($in.mode -eq 'folders') {
  $list = [System.Collections.Generic.List[object]]::new()
  function Walk($f, $depth) {
    foreach ($c in $f.Folders) {
      if (Skip $c) { continue }
      $list.Add([ordered]@{ path = (Rel $c); depth = $depth; unread = [int]$c.UnReadItemCount })
      Walk $c ($depth + 1)
    }
  }
  Walk $root 0
  ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{ inbox = (Rel $inbox); folders = @($list) })
  return
}

$out = [ordered]@{}
function Add-Mail($m, $folder) {
  if ($m.Class -ne 43) { return } # olMail only (no meeting requests, reports)
  $id = $m.EntryID
  if ($out.Contains($id)) { return }
  $addr = if ($m.SenderEmailType -eq 'SMTP') { $m.SenderEmailAddress } else { '' }
  $o = [ordered]@{
    id = $id; folder = $folder; conv = [string]$m.ConversationID; received = $m.ReceivedTime.ToUniversalTime().ToString('o')
    from = [string]$m.SenderName; fromAddr = [string]$addr; to = [string]$m.To; cc = [string]$m.CC
    subject = [string]$m.Subject; unread = [bool]$m.UnRead; importance = [int]$m.Importance; attach = [int]$m.Attachments.Count
  }
  if (-not $known.ContainsKey($id)) {
    $b = [string]$m.Body
    $b = ($b -replace '\s+', ' ').Trim()
    $o.body = $b.Substring(0, [Math]::Min(2000, $b.Length))
  }
  $out[$id] = $o
}

$picked = @($in.folders | Where-Object { $_ })
$missing = [System.Collections.Generic.List[string]]::new()
$n = 0
foreach ($path in $picked) {
  $f = $root
  foreach ($part in $path.Split('\')) { try { $f = $f.Folders.Item($part) } catch { $f = $null }; if (-not $f) { break } }
  if (-not $f -or (Skip $f)) { $missing.Add($path); continue }
  if ($f.UnReadItemCount -eq 0) { continue }
  # newest first, stop at the first one older than the cutoff (no date in the filter: Jet date literals depend on the locale)
  $unread = $f.Items.Restrict('[UnRead] = True')
  $unread.Sort('[ReceivedTime]', $true)
  $m = $unread.GetFirst()
  while ($m -and $n -lt $limit) {
    if ($cutoff -and $m.ReceivedTime.ToUniversalTime() -lt $cutoff) { break }
    Add-Mail $m $path; $n++
    $m = $unread.GetNext()
  }
}

ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{ me = [string]$ns.CurrentUser.Name; missing = @($missing); items = @($out.Values) })
} catch {
  $msg = $_.Exception.Message
  if ($msg -match '80040154|REGDB_E_CLASSNOTREG') { $msg = 'classic Outlook is not installed' }
  ConvertTo-Json -Compress -InputObject @{ error = $msg }
}
