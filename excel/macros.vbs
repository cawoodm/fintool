Option Explicit

Public Sub ExportSheetToCsv()
    ExportSheet "Payments", "C:\projects\Marc\fintool\data\payments.csv", Array("A", "D", "E", "F", "G", "H", "I", "J", "K")
    ExportSheet "Overview", "C:\projects\Marc\fintool\data\categories.csv", Array("A", "B", "C", "D", "E", "F")
    ExportSheet "Income", "C:\projects\Marc\fintool\data\income.csv", Array("A", "B", "C", "I", "J", "K", "L", "M")
End Sub

Public Function ExportSheet(ByVal worksheetName As String, _
                                 ByVal filePath As String, _
                                 ByVal columns As Variant) As Boolean

    Dim wsSrc As Worksheet
    Dim wbTemp As Workbook
    Dim wsTemp As Worksheet
    Dim lastRow As Long
    Dim i As Long
    Dim srcCol As Variant
    Dim dstCol As Long
    Dim prevCalc As XlCalculation
    Dim errMsg As String
    Dim errNum As Long

    On Error GoTo Fail

    Set wsSrc = ThisWorkbook.Worksheets(worksheetName)
    
    ' Remove any AutoFilter on the source sheet to ensure ALL data is exported
    If wsSrc.AutoFilterMode Then wsSrc.AutoFilter.ShowAllData

    prevCalc = Application.Calculation
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = xlCalculationManual

    lastRow = 1
    For i = LBound(columns) To UBound(columns)
        srcCol = columns(i)
        lastRow = Application.Max(lastRow, wsSrc.Cells(wsSrc.Rows.Count, srcCol).End(xlUp).Row)
    Next i

    Set wbTemp = Workbooks.Add(xlWBATWorksheet)
    Set wsTemp = wbTemp.Worksheets(1)

    dstCol = 1
    For i = LBound(columns) To UBound(columns)
        srcCol = columns(i)
        wsTemp.Cells(1, dstCol).Resize(lastRow, 1).Value = wsSrc.Cells(1, srcCol).Resize(lastRow, 1).Value
        dstCol = dstCol + 1
    Next i

    Application.DisplayAlerts = False
    wbTemp.SaveAs Filename:=filePath, FileFormat:=xlCSV, Local:=True
    wbTemp.Close SaveChanges:=False
    Application.DisplayAlerts = True

    Application.Calculation = prevCalc
    Application.EnableEvents = True
    Application.ScreenUpdating = True

    Exit Function

Fail:
    On Error Resume Next
    
    errNum = Err.Number
    errMsg = errNum & ": " & Err.Description
    If errNum = 0 Then
        errMsg = "Make sure " & Path & " is not open in Excel!"
    End If
    
    Application.DisplayAlerts = True
    Application.Calculation = prevCalc
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    If Not wbTemp Is Nothing Then wbTemp.Close SaveChanges:=False
    MsgBox "Failed: " & errMsg
End Function
