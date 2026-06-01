# Stop hook — Windows toast on generation end.
#
# Toast (not FlashWindowEx) because the hook is spawned async, so PowerShell is
# not the foreground process; Windows foreground-lock suppresses flash calls
# from non-foreground processes. Toasts go through Action Center and bypass
# that restriction. The toast carries its own default sound — no separate beep.

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null

$xml = @'
<toast><visual><binding template="ToastText02">
<text id="1">Claude Code</text>
<text id="2">Generation complete</text>
</binding></visual></toast>
'@

$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claude Code').Show($toast)
