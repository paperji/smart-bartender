param([string[]]$Files)
# 새 Excel 인스턴스(사용자가 연 Excel과 별개)로 열어 전체 재계산 → 오류 셀 검사 → 저장(캐시 값 기록) → 이 인스턴스만 종료
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.ScreenUpdating = $false
$out = @()
try {
  foreach ($f in $Files) {
    $wb = $xl.Workbooks.Open($f)
    $xl.CalculateFull()
    $errs = @()
    $nform = 0
    foreach ($ws in $wb.Worksheets) {
      $ur = $ws.UsedRange
      foreach ($c in $ur.Cells) {
        if ($c.HasFormula) { $nform++ }
        $t = [string]$c.Text
        if ($t -match '^#(NAME|VALUE|REF|DIV/0|N/A|NUM|NULL)') { $errs += ("{0}!{1}={2}" -f $ws.Name, $c.Address($false,$false), $t) }
      }
    }
    # 요약 시트 금액 열(B) 값 기록
    $sum = $wb.Worksheets.Item('요약')
    $vals = @()
    for ($r = 1; $r -le 40; $r++) {
      $a = [string]$sum.Cells.Item($r,1).Text; $b = [string]$sum.Cells.Item($r,2).Text
      if ($b -ne '' -and $a -ne '') { $vals += ("{0} => {1}" -f $a.Trim(), $b) }
    }
    $wb.RemovePersonalInformation = $true; $wb.Save()
    $wb.Close($false)
    $out += [pscustomobject]@{ file = (Split-Path $f -Leaf); formulas = $nform; errors = $errs; summary = $vals }
  }
} finally {
  $xl.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
$out | ConvertTo-Json -Depth 4

