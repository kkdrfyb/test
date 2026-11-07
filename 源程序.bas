Option Explicit

'===== 模式1：从头全部重建（重命名文件夹 + 更新链接）=====
Sub BuildAllLink()
    Dim rootPath As String
    Dim lastRow As Long, i As Long
    Dim fso As Object
    Dim docxFullName As String
    Dim baseName As String
    Dim oldFolderPath As String, newFolderPath As String
    Dim newDispText As String

    Set fso = CreateObject("Scripting.FileSystemObject")
    rootPath = fso.GetAbsolutePathName(ThisWorkbook.Path) '标准化根路径

    lastRow = Cells(Rows.Count, "A").End(xlUp).Row

    Application.ScreenUpdating = False
    For i = 2 To lastRow
        Dim seqNo As String
        seqNo = Trim(Cells(i, "A").Value)
        If seqNo <> "" Then
            '源文件夹：不带末尾\
            oldFolderPath = fso.BuildPath(rootPath, seqNo)

            If fso.FolderExists(oldFolderPath) Then
                docxFullName = GetFirstDocx(oldFolderPath)
                If docxFullName <> "" Then
                    baseName = fso.GetBaseName(docxFullName)
                    newDispText = seqNo & "-" & baseName
                    newFolderPath = fso.BuildPath(rootPath, newDispText)

                    '只有目标不存在，才尝试重命名
                    If Not fso.FolderExists(newFolderPath) Then
                        On Error Resume Next
                        fso.MoveFolder oldFolderPath, newFolderPath
                        On Error GoTo 0

                        '再次检查：移动是否成功
                        If Not fso.FolderExists(newFolderPath) Then
                            Cells(i, "B").Value = "【重命名失败】文件被占用/权限不足"
                            Cells(i, "B").Hyperlinks.Delete
                            GoTo NextRow
                        End If
                    End If

                    '更新超链接
                    Dim finalDocPath As String
                    finalDocPath = fso.BuildPath(newFolderPath, fso.GetFileName(docxFullName))

                    Cells(i, "B").Hyperlinks.Delete
                    ActiveSheet.Hyperlinks.Add _
                        Anchor:=Cells(i, "B"), _
                        Address:=finalDocPath, _
                        TextToDisplay:=newDispText
                Else
                    Cells(i, "B").Value = "无docx文件"
                    Cells(i, "B").Hyperlinks.Delete
                End If
            Else
                Cells(i, "B").Value = "文件夹不存在"
                Cells(i, "B").Hyperlinks.Delete
            End If
        End If
NextRow:
    Next i
    Application.ScreenUpdating = True
    MsgBox "【全部重建执行完毕，请检查失败标记】", vbInformation
End Sub

'===== 模式2：增量模式，只处理B列为空的行，已有链接不动 =====
Sub AppendNewLink()
    Dim rootPath As String
    Dim lastRow As Long, i As Long
    Dim fso As Object
    Dim docxFullName As String
    Dim baseName As String
    Dim oldFolderPath As String, newFolderPath As String
    Dim newDispText As String

    Set fso = CreateObject("Scripting.FileSystemObject")
    rootPath = fso.GetAbsolutePathName(ThisWorkbook.Path)

    lastRow = Cells(Rows.Count, "A").End(xlUp).Row

    Application.ScreenUpdating = False
    For i = 2 To lastRow
        If Trim(Cells(i, "B").Value) = "" Then
            Dim seqNo As String
            seqNo = Trim(Cells(i, "A").Value)
            If seqNo <> "" Then
                oldFolderPath = fso.BuildPath(rootPath, seqNo)

                If fso.FolderExists(oldFolderPath) Then
                    docxFullName = GetFirstDocx(oldFolderPath)
                    If docxFullName <> "" Then
                        baseName = fso.GetBaseName(docxFullName)
                        newDispText = seqNo & "-" & baseName
                        newFolderPath = fso.BuildPath(rootPath, newDispText)

                        If Not fso.FolderExists(newFolderPath) Then
                            On Error Resume Next
                            fso.MoveFolder oldFolderPath, newFolderPath
                            On Error GoTo 0

                            If Not fso.FolderExists(newFolderPath) Then
                                Cells(i, "B").Value = "【重命名失败】文件被占用/权限不足"
                                GoTo NextInc
                            End If
                        End If

                        Dim finalDocPath As String
                        finalDocPath = fso.BuildPath(newFolderPath, fso.GetFileName(docxFullName))

                        ActiveSheet.Hyperlinks.Add _
                            Anchor:=Cells(i, "B"), _
                            Address:=finalDocPath, _
                            TextToDisplay:=newDispText
                    Else
                        Cells(i, "B").Value = "无docx文件"
                    End If
                Else
                    Cells(i, "B").Value = "文件夹不存在"
                End If
            End If
        End If
NextInc:
    Next i
    Application.ScreenUpdating = True
    MsgBox "【增量更新执行完毕，请检查失败标记】", vbInformation
End Sub

'===== 内部函数：取文件夹内第一个docx完整路径 =====
Function GetFirstDocx(folderPath As String) As String
    Dim fso As Object
    Dim fd As Object, oneFile As Object
    GetFirstDocx = ""
    Set fso = CreateObject("Scripting.FileSystemObject")
    Set fd = fso.GetFolder(folderPath)

    For Each oneFile In fd.Files
        If LCase(fso.GetExtensionName(oneFile.Path)) = "docx" Then
            GetFirstDocx = oneFile.Path
            Exit Function
        End If
    Next oneFile
End Function
