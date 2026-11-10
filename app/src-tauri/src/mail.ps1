# yatai: read the Inbox of the local (classic) Outlook through COM. Read-only.
# In (stdin, JSON): { "days": 14, "limit": 200, "known": ["<EntryID>", ...] }
# Out (stdout, JSON): { "error": "…" } or { "me": "<name>", "items": [ { id, conv, received, from, fromAddr, to, cc, subject, unread, importance, attach, body? } ] }
#   the unread mail received in the last `days` days (0 = any age), newest first, at most `limit`.
#   `body` (the first 2000 characters of the plain text) only for ids not in `known`: the classifier needs it once.
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
$out = [ordered]@{}

function Add-Mail($m) {
  if ($m.Class -ne 43) { return } # olMail only (no meeting requests, reports)
  $id = $m.EntryID
  if ($out.Contains($id)) { return }
  $addr = if ($m.SenderEmailType -eq 'SMTP') { $m.SenderEmailAddress } else { '' }
  $o = [ordered]@{
    id = $id; conv = [string]$m.ConversationID; received = $m.ReceivedTime.ToUniversalTime().ToString('o')
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

# newest first, stop at the first one older than the cutoff (no date in the filter: Jet date literals depend on the locale)
$unread = $inbox.Items.Restrict('[UnRead] = True')
$unread.Sort('[ReceivedTime]', $true)
$m = $unread.GetFirst(); $n = 0
while ($m -and $n -lt $limit) {
  if ($cutoff -and $m.ReceivedTime.ToUniversalTime() -lt $cutoff) { break }
  Add-Mail $m; $n++
  $m = $unread.GetNext()
}

ConvertTo-Json -Compress -Depth 4 -InputObject ([ordered]@{ me = [string]$ns.CurrentUser.Name; items = @($out.Values) })
} catch {
  $msg = $_.Exception.Message
  if ($msg -match '80040154|REGDB_E_CLASSNOTREG') { $msg = 'classic Outlook is not installed' }
  ConvertTo-Json -Compress -InputObject @{ error = $msg }
}
