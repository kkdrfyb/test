Attribute VB_Name = "modFileLink"
Option Explicit

'====================================================================================
'  modFileLink —— 文件链接维护加载项
'  Ribbon：「我的工具」→「文件链接」→ 更新所选行 / 末尾新增行链接
'
'  目录结构（整个文件夹可直接复制给他人使用，无需改程序）：
'      大文件夹\
'         ├─ test.xlsx                表格（文件名由常量 WB_NAME 指定）
'         ├─ MyTools.xlam             本加载项
'         ├─ 1-cryaf3qa\cryaf3qa.docx
'         ├─ 2-9g12723w\9g12723w.docx
'         └─ …
'
'  根目录：读取表格 test.xlsx 所在的目录（不使用绝对路径硬编码，方便整体复制）
'  对应规则：序号-文件名\文件名.docx（文件夹名不规范时自动改名）
'  B 列：相对路径链接（地址形如 1-cryaf3qa\cryaf3qa.docx），可直接点击打开
'        单元格显示的是文件名本身且不带后缀（cryaf3qa），地址仍是完整相对路径
'        文件夹不存在 / 文件夹无内容时，B 列留空，不写任何占位文字
'====================================================================================

'---------------------------- 可调常量 ----------------------------
Private Const WB_NAME          As String = "test.xlsx"  ' 表格文件名，与大文件夹同级
Private Const EXT_TARGET       As String = "docx"       ' 关注的目标文件扩展名
Private Const COL_SEQ          As String = "A"          ' 序号列
Private Const COL_LINK         As String = "B"          ' 链接列
Private Const HEADER_ROWS      As Long = 1              ' 表头行数
Private Const AUTO_RENAME      As Boolean = True        ' 文件夹命名与文件名保持一致
Private Const SHOW_REPORT      As Boolean = True        ' 运行结束后显示计数

'---------------------------- 运行状态 ----------------------------
Private mStopFlag   As Boolean ' 多文件时选择「取消」则中止本次任务

Private Type TResult
    Linked      As Long   ' 成功写入链接
    Renamed     As Long   ' 文件夹被改名
    RenameFail  As Long   ' 改名失败（文件被占用等）
    LinkFail    As Long   ' 链接写入失败
    NoFolder    As Long   ' 文件夹不存在（单元格留空）
    NoFile      As Long   ' 文件夹无目标文件（单元格留空）
    Pending     As Long   ' 多目标文件，本次跳过
    Manual      As Long   ' 人工指定文件的次数
    Skipped     As Long   ' 末尾模式跳过的已有链接
    BlankSeq    As Long   ' 序号为空的行
End Type

'====================================================================================
'  一、Ribbon 回调（形参统一用 Variant，避免 Office 传参类型不符报错）
'====================================================================================

Public Sub Ribbon_UpdateSelected(Optional ByVal control As Variant)
    RunSelectionJob
End Sub

Public Sub Ribbon_LinkTailRows(Optional ByVal control As Variant)
    RunTailJob
End Sub

'====================================================================================
'  二、两个入口
'====================================================================================

' 入口一：先选中行，再更新这些行的链接（会先清空这些行的 B 列再重新生成）
Private Sub RunSelectionJob()
    Dim wb As Workbook, ws As Worksheet, rootPath As String, lastSeq As Long
    Dim startRow As Long, endRow As Long

    If Not GetContext(wb, ws, rootPath, lastSeq) Then Exit Sub
    If Not ResolveSelectionRange(ws, lastSeq, startRow, endRow) Then
        MsgBox "请先在表格中选中要更新的行（单击某行的任意单元格即代表该行，也可框选多行）。", vbInformation, "文件链接维护"
        Exit Sub
    End If

    Execute ws, rootPath, startRow, endRow, True, "更新所选行"
End Sub

' 入口二：处理末尾新增的行（最后一条已有链接的下一行 ~ A 列最后一行）
Private Sub RunTailJob()
    Dim wb As Workbook, ws As Worksheet, rootPath As String, lastSeq As Long
    Dim startRow As Long, endRow As Long

    If Not GetContext(wb, ws, rootPath, lastSeq) Then Exit Sub
    If Not ResolveTailRange(ws, lastSeq, startRow, endRow) Then
        MsgBox "没有检测到末尾新增行（最后一行已经存在链接）。", vbInformation, "文件链接维护"
        Exit Sub
    End If

    Execute ws, rootPath, startRow, endRow, False, "末尾新增行链接"
End Sub

'====================================================================================
'  三、环境与行范围
'====================================================================================

' 定位根目录与表格：优先取已打开的 WB_NAME；否则打开加载项同目录下的同名表格
Private Function GetContext(ByRef wb As Workbook, ByRef ws As Worksheet, _
                            ByRef rootPath As String, ByRef lastSeq As Long) As Boolean
    Dim wbTmp As Workbook, fn As String

    If Not Application.ActiveWorkbook Is Nothing Then
        If StrComp(Application.ActiveWorkbook.Name, WB_NAME, vbTextCompare) = 0 Then
            Set wb = Application.ActiveWorkbook
        End If
    End If

    If wb Is Nothing Then
        For Each wbTmp In Application.Workbooks
            If StrComp(wbTmp.Name, WB_NAME, vbTextCompare) = 0 Then
                If Len(ThisWorkbook.Path) > 0 Then
                    If StrComp(wbTmp.Path, ThisWorkbook.Path, vbTextCompare) = 0 Then
                        Set wb = wbTmp
                        Exit For
                    End If
                End If
                If wb Is Nothing Then Set wb = wbTmp
            End If
        Next wbTmp
    End If

    If wb Is Nothing And Len(ThisWorkbook.Path) > 0 Then
        fn = EnsureTrailingSep(ThisWorkbook.Path) & WB_NAME
        If Len(Dir(fn)) > 0 Then
            Set wb = Application.Workbooks.Open(fn)
        End If
    End If

    If wb Is Nothing Then
        MsgBox "未找到表格 " & WB_NAME & "。" & vbCrLf & _
               "请把它与文件夹放在同一层并保持此文件名，或先打开该表格后再运行。", vbExclamation, "文件链接维护"
        Exit Function
    End If

    wb.Activate

    If Not TypeOf wb.ActiveSheet Is Worksheet Then
        MsgBox "当前活动工作表不是普通工作表，请切换到数据所在的工作表后重试。", vbExclamation, "文件链接维护"
        Exit Function
    End If
    Set ws = wb.ActiveSheet

    If ws.ProtectContents Then
        MsgBox "工作表处于保护状态，请先撤销保护再运行。", vbExclamation, "文件链接维护"
        Exit Function
    End If

    If Len(wb.Path) = 0 Then
        MsgBox "表格尚未保存，无法确定根目录，请先保存。", vbExclamation, "文件链接维护"
        Exit Function
    End If

    rootPath = wb.Path
    lastSeq = ws.Cells(ws.Rows.Count, COL_SEQ).End(xlUp).Row
    GetContext = True
End Function

' 所选行 → 行范围（裁剪到数据区，避免整列选中时扫描百万行）
Private Function ResolveSelectionRange(ByVal ws As Worksheet, ByVal lastSeq As Long, _
                                       ByRef startRow As Long, ByRef endRow As Long) As Boolean
    Dim dataStart As Long

    On Error Resume Next
    startRow = Selection.Row
    endRow = Selection.Row + Selection.Rows.Count - 1
    On Error GoTo 0
    If startRow <= 0 Or endRow <= 0 Then Exit Function

    dataStart = HEADER_ROWS + 1
    If startRow < dataStart Then startRow = dataStart
    If endRow > lastSeq Then endRow = lastSeq
    If endRow < startRow Then Exit Function

    ResolveSelectionRange = True
End Function

' 末尾新增行 → 行范围：最后一条已有链接的下一行 ~ A 列最后一行
Private Function ResolveTailRange(ByVal ws As Worksheet, ByVal lastSeq As Long, _
                                  ByRef startRow As Long, ByRef endRow As Long) As Boolean
    Dim dataStart As Long, lastContent As Long

    dataStart = HEADER_ROWS + 1
    If lastSeq < dataStart Then Exit Function

    lastContent = LastContentRow(ws, dataStart, lastSeq)
    startRow = lastContent + 1
    If startRow < dataStart Then startRow = dataStart
    endRow = lastSeq

    If endRow < startRow Then Exit Function
    ResolveTailRange = True
End Function

' B 列最后一个「有内容」的行号（优先看超链接，其次看单元格文本）
Private Function LastContentRow(ByVal ws As Worksheet, ByVal fromRow As Long, ByVal toRow As Long) As Long
    Dim i As Long

    For i = toRow To fromRow Step -1
        If ws.Cells(i, COL_LINK).Hyperlinks.Count > 0 Then
            LastContentRow = i
            Exit Function
        End If
        If Len(CellText(ws, i, COL_LINK)) > 0 Then
            LastContentRow = i
            Exit Function
        End If
    Next i

    LastContentRow = fromRow - 1
End Function

'====================================================================================
'  四、主流程
'====================================================================================

Private Sub Execute(ByVal ws As Worksheet, ByVal rootPath As String, _
                    ByVal startRow As Long, ByVal endRow As Long, _
                    ByVal overwrite As Boolean, ByVal modeName As String)
    Dim fso As Object
    Dim dictFull As Object, dictNamed As Object, dictNamedCount As Object, dictNumeric As Object
    Dim i As Long
    Dim r As TResult
    Dim oldCalc As XlCalculation
    Dim calcSaved As Boolean

    On Error GoTo CleanFail

    Set fso = CreateObject("Scripting.FileSystemObject")
    BuildFolderIndex fso, rootPath, dictFull, dictNamed, dictNamedCount, dictNumeric

    oldCalc = Application.Calculation
    calcSaved = True
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    Application.EnableEvents = False
    mStopFlag = False

    For i = startRow To endRow
        If i Mod 50 = 0 Then Application.StatusBar = "正在处理第 " & i & " / " & endRow & " 行…"
        DoEvents
        If mStopFlag Then Exit For
        ProcessRow ws, fso, rootPath, i, dictFull, dictNamed, dictNamedCount, dictNumeric, r, overwrite
    Next i

    GoTo CleanUp

CleanFail:
    If Err.Number <> 0 Then
        MsgBox "运行过程中出错（第 " & i & " 行）：" & Err.Description, vbExclamation, "文件链接维护"
    End If

CleanUp:
    On Error Resume Next
    Application.ScreenUpdating = True
    If calcSaved Then Application.Calculation = oldCalc
    Application.EnableEvents = True
    Application.StatusBar = False
    On Error GoTo 0

    If SHOW_REPORT Then ShowReport modeName, startRow, endRow, r, mStopFlag
End Sub

'====================================================================================
'  五、单行处理
'====================================================================================

Private Sub ProcessRow(ByVal ws As Worksheet, ByVal fso As Object, ByVal rootPath As String, _
                       ByVal rowIdx As Long, ByVal dictFull As Object, ByVal dictNamed As Object, _
                       ByVal dictNamedCount As Object, ByVal dictNumeric As Object, _
                       ByRef r As TResult, ByVal overwrite As Boolean)
    Dim seqText As String, seqPart As String, dashPos As Long
    Dim folderPath As String, fileFullName As String, fileBase As String, fileName As String
    Dim expectedName As String, newPath As String, oldName As String
    Dim files As Object, picked As String
    Dim ans As VbMsgBoxResult

    seqText = CellText(ws, rowIdx, COL_SEQ)
    If Len(seqText) = 0 Then
        r.BlankSeq = r.BlankSeq + 1
        Exit Sub
    End If

    If Not overwrite Then
        If ws.Cells(rowIdx, COL_LINK).Hyperlinks.Count > 0 Then
            r.Skipped = r.Skipped + 1
            Exit Sub
        End If
    End If

    ' 先清空本单元格：文件夹为空/不存在时保持留空，不写占位文字
    ClearLink ws, rowIdx

    dashPos = InStr(1, seqText, "-", vbBinaryCompare)
    If dashPos > 0 Then seqPart = Left$(seqText, dashPos - 1) Else seqPart = seqText

    If Not ResolveFolder(rootPath, seqPart, seqText, dictFull, dictNamed, dictNamedCount, dictNumeric, folderPath) Then
        r.NoFolder = r.NoFolder + 1
        Exit Sub
    End If

    Set files = ListTargetFiles(fso, folderPath)

    Select Case files.Count
        Case 0
            r.NoFile = r.NoFile + 1
            Exit Sub

        Case 1
            fileFullName = CStr(files(1))

        Case Else
            ans = MsgBox(modeTip(files.Count, folderPath, files), vbYesNoCancel + vbQuestion, "请指定要链接的文件")
            If ans = vbCancel Then
                mStopFlag = True
                Exit Sub
            End If
            If ans = vbNo Then
                r.Pending = r.Pending + 1
                Exit Sub
            End If
            picked = PickFileDialog(rootPath)
            If Len(picked) = 0 Then
                r.Pending = r.Pending + 1
                Exit Sub
            End If
            fileFullName = picked
            r.Manual = r.Manual + 1
    End Select

    fileBase = fso.GetBaseName(fileFullName)
    fileName = fso.GetFileName(fileFullName)

    ' 文件夹命名与文件名保持一致：序号-文件名
    If AUTO_RENAME Then
        oldName = fso.GetFolder(folderPath).Name
        expectedName = seqPart & "-" & fileBase
        If StrComp(oldName, expectedName, vbTextCompare) <> 0 Then
            newPath = EnsureTrailingSep(fso.GetParentFolderName(folderPath)) & expectedName
            If Not fso.FolderExists(newPath) Then
                If SafeRename(fso, folderPath, newPath) Then
                    folderPath = newPath
                    UpdateIndex rootPath, expectedName, seqPart, dictFull, dictNamed, dictNamedCount
                    r.Renamed = r.Renamed + 1
                Else
                    r.RenameFail = r.RenameFail + 1
                    Exit Sub
                End If
            Else
                folderPath = newPath
            End If
        End If
    End If

    If WriteLink(ws, rowIdx, fso.GetFolder(folderPath).Name, fileName, fileBase) Then
        r.Linked = r.Linked + 1
    Else
        r.LinkFail = r.LinkFail + 1
    End If
End Sub

Private Function modeTip(ByVal count As Long, ByVal folderPath As String, ByVal files As Object) As String
    Dim i As Long, s As String, nm As String, p As Long

    s = "下列文件夹中有 " & count & " 个 Word 文件：" & vbCrLf & vbCrLf
    s = s & folderPath & vbCrLf
    For i = 1 To files.Count
        ' 与链接展示保持一致：只列文件名，不含后缀
        nm = CStr(files(i))
        p = InStrRev(nm, "\")
        If p > 0 Then nm = Mid$(nm, p + 1)
        p = InStrRev(nm, ".")
        If p > 1 Then nm = Left$(nm, p - 1)
        s = s & "   " & i & ". " & nm & vbCrLf
    Next i
    s = s & vbCrLf & "　是(Y)：手动选择要链接的文件" & vbCrLf
    s = s & "　否(N)：跳过本行，链接留空" & vbCrLf
    s = s & "　取消：中止本次任务"

    modeTip = s
End Function

'====================================================================================
'  六、文件夹索引与定位
'====================================================================================

Private Sub BuildFolderIndex(ByVal fso As Object, ByVal rootPath As String, _
                             ByRef dictFull As Object, ByRef dictNamed As Object, _
                             ByRef dictNamedCount As Object, ByRef dictNumeric As Object)
    Dim rootFolder As Object, one As Object, nm As String, prefix As String, dashPos As Long

    Set dictFull = CreateObject("Scripting.Dictionary")
    Set dictNamed = CreateObject("Scripting.Dictionary")
    Set dictNamedCount = CreateObject("Scripting.Dictionary")
    Set dictNumeric = CreateObject("Scripting.Dictionary")

    Set rootFolder = fso.GetFolder(rootPath)

    For Each one In rootFolder.SubFolders
        nm = one.Name
        dictFull(nm) = one.Path

        If IsDigits(nm) Then
            dictNumeric(nm) = one.Path
        Else
            dashPos = InStr(1, nm, "-", vbBinaryCompare)
            If dashPos > 1 Then
                prefix = Left$(nm, dashPos - 1)
                If IsDigits(prefix) Then
                    If dictNamed.Exists(prefix) Then
                        dictNamed(prefix) = CStr(dictNamed(prefix)) & "||" & one.Path
                        dictNamedCount(prefix) = CLng(dictNamedCount(prefix)) + 1
                    Else
                        dictNamed(prefix) = one.Path
                        dictNamedCount(prefix) = 1
                    End If
                End If
            End If
        End If
    Next one
End Sub

Private Function ResolveFolder(ByVal rootPath As String, ByVal seqPart As String, ByVal seqText As String, _
                               ByVal dictFull As Object, ByVal dictNamed As Object, _
                               ByVal dictNamedCount As Object, ByVal dictNumeric As Object, _
                               ByRef folderPath As String) As Boolean
    Dim paths() As String

    ' A 列写的是完整文件夹名时优先精确匹配
    If InStr(1, seqText, "-", vbBinaryCompare) > 0 Then
        If dictFull.Exists(seqText) Then
            folderPath = CStr(dictFull(seqText))
            ResolveFolder = True
            Exit Function
        End If
    End If

    If dictNamed.Exists(seqPart) Then
        If CLng(dictNamedCount(seqPart)) = 1 Then
            folderPath = CStr(dictNamed(seqPart))
        Else
            paths = Split(CStr(dictNamed(seqPart)), "||")
            folderPath = PickBestFolder(rootPath, paths)
        End If
        ResolveFolder = True
        Exit Function
    End If

    If dictNumeric.Exists(seqPart) Then
        folderPath = CStr(dictNumeric(seqPart))
        ResolveFolder = True
        Exit Function
    End If
End Function

' 同一序号存在多个文件夹时，优先取「文件夹名已与内部唯一 Word 文件一致」的那个
Private Function PickBestFolder(ByVal rootPath As String, ByRef paths() As String) As String
    Dim i As Long, nm As String, files As Object, fso As Object, seqPart As String

    Set fso = CreateObject("Scripting.FileSystemObject")
    PickBestFolder = paths(LBound(paths))

    For i = LBound(paths) To UBound(paths)
        nm = fso.GetFolder(paths(i)).Name
        Set files = ListTargetFiles(fso, paths(i))
        If files.Count = 1 Then
            If InStr(1, nm, "-", vbBinaryCompare) > 1 Then
                seqPart = Left$(nm, InStr(1, nm, "-", vbBinaryCompare) - 1)
                If IsDigits(seqPart) Then
                    If StrComp(nm, seqPart & "-" & fso.GetBaseName(CStr(files(1))), vbTextCompare) = 0 Then
                        PickBestFolder = paths(i)
                        Exit Function
                    End If
                End If
            End If
        End If
    Next i
End Function

Private Sub UpdateIndex(ByVal rootPath As String, ByVal newName As String, ByVal seqPart As String, _
                        ByVal dictFull As Object, ByVal dictNamed As Object, ByVal dictNamedCount As Object)
    On Error Resume Next
    dictFull(newName) = EnsureTrailingSep(rootPath) & newName
    If dictNamed.Exists(seqPart) Then
        If CLng(dictNamedCount(seqPart)) = 1 Then dictNamed(seqPart) = EnsureTrailingSep(rootPath) & newName
    End If
    On Error GoTo 0
End Sub

'====================================================================================
'  七、链接写入（相对路径）
'====================================================================================

' 链接地址仍是相对路径（保证可点击、可迁移），但「显示出来的文字」统一取
' 文件名本身且不带扩展名，例如 cryaf3qa.docx → cryaf3qa
Private Function WriteLink(ByVal ws As Worksheet, ByVal rowIdx As Long, _
                           ByVal folderName As String, ByVal fileName As String, ByVal fileBase As String) As Boolean
    Dim relPath As String

    relPath = folderName & "\" & fileName          ' 相对表格所在目录，便于整体复制

    On Error Resume Next
    ws.Hyperlinks.Add Anchor:=ws.Cells(rowIdx, COL_LINK), _
                      Address:=relPath, _
                      ScreenTip:=relPath, _
                      TextToDisplay:=fileBase      ' 只显示文件名，不含后缀
    WriteLink = (Err.Number = 0)
    On Error GoTo 0
End Function

Private Sub ClearLink(ByVal ws As Worksheet, ByVal rowIdx As Long)
    On Error Resume Next
    ws.Cells(rowIdx, COL_LINK).Hyperlinks.Delete
    ws.Cells(rowIdx, COL_LINK).Value = ""
    On Error GoTo 0
End Sub

Private Function PickFileDialog(ByVal rootPath As String) As String
    On Error Resume Next
    With Application.FileDialog(msoFileDialogFilePicker)
        .Title = "选择要链接的 Word 文件"
        .InitialFileName = EnsureTrailingSep(rootPath)
        .Filters.Clear
        .Filters.Add "Word 文档", "*." & EXT_TARGET
        .AllowMultiSelect = False
        If .Show <> -1 Then Exit Function
        PickFileDialog = CStr(.SelectedItems(1))
    End With
    On Error GoTo 0
End Function

'====================================================================================
'  八、通用工具
'====================================================================================

Private Function ListTargetFiles(ByVal fso As Object, ByVal folderPath As String) As Object
    Dim result As Collection, fd As Object, one As Object, ext As String

    Set result = New Collection
    Set fd = fso.GetFolder(folderPath)

    For Each one In fd.Files
        ext = LCase$(fso.GetExtensionName(one.Path))
        If Left$(one.Name, 2) <> "~$" And ext = LCase$(EXT_TARGET) Then result.Add one.Path
    Next one

    Set ListTargetFiles = result
End Function

Private Function SafeRename(ByVal fso As Object, ByVal oldPath As String, ByVal newPath As String) As Boolean
    On Error Resume Next
    fso.MoveFolder oldPath, newPath
    SafeRename = (Err.Number = 0) And fso.FolderExists(newPath)
    On Error GoTo 0
End Function

' 安全读取单元格文本：Empty/Null/错误值/对象一律得到 ""，绝不抛「类型不匹配」
Private Function ToText(ByVal value As Variant) As String
    On Error Resume Next
    If IsObject(value) Then
        ToText = ""
    ElseIf IsNull(value) Then
        ToText = ""
    ElseIf IsError(value) Then
        ToText = ""
    Else
        ToText = CStr(value)
    End If
    On Error GoTo 0
End Function

Private Function CellText(ByVal ws As Worksheet, ByVal rowIdx As Long, ByVal col As String) As String
    On Error Resume Next
    CellText = Trim$(ToText(ws.Cells(rowIdx, col).Value))
    On Error GoTo 0
End Function

Private Function IsDigits(ByVal text As String) As Boolean
    Dim i As Long, c As String

    If Len(text) = 0 Then Exit Function
    For i = 1 To Len(text)
        c = Mid$(text, i, 1)
        If c < "0" Or c > "9" Then Exit Function
    Next i
    IsDigits = True
End Function

Private Function EnsureTrailingSep(ByVal folderPath As String) As String
    EnsureTrailingSep = folderPath
    If Len(folderPath) = 0 Then Exit Function
    If Right$(folderPath, 1) <> "\" Then EnsureTrailingSep = folderPath & "\"
End Function

Private Sub ShowReport(ByVal modeName As String, ByVal startRow As Long, ByVal endRow As Long, _
                       ByRef r As TResult, ByVal aborted As Boolean)
    Dim s As String

    s = "【" & modeName & "】执行完毕。" & vbCrLf & vbCrLf
    s = s & "处理范围：第 " & startRow & " – " & endRow & " 行" & vbCrLf & vbCrLf
    s = s & "生成链接：" & r.Linked & "　文件夹改名：" & r.Renamed & vbCrLf
    s = s & "跳过已有链接：" & r.Skipped & "　序号为空：" & r.BlankSeq & vbCrLf
    s = s & "文件夹不存在（留空）：" & r.NoFolder & "　无内容（留空）：" & r.NoFile & vbCrLf
    s = s & "待人工确认：" & r.Pending & "　人工指定文件：" & r.Manual & vbCrLf
    s = s & "失败：改名 " & r.RenameFail & "　写链接 " & r.LinkFail
    If aborted Then s = s & vbCrLf & vbCrLf & "注意：本次任务被取消，未完成的行下次需要重新处理。"

    MsgBox s, vbInformation, "文件链接维护"
End Sub
