$raw = [Console]::In.ReadToEnd()
try { $cmd = ($raw | ConvertFrom-Json).tool_input.command } catch { $cmd = '' }

if ($cmd -match '(?<![\w-])python3(?![\w])') {
    [Console]::Error.WriteLine("Use 'python', not 'python3'. On Windows 'python3' triggers the Microsoft Store alias. Re-run with 'python'.")
    exit 2
}

exit 0
