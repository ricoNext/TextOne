# 文件夹新建 / 重命名 / 移动 / 删除

> TextOne · 库与文件管理 · 第一刀  
> 日期：2026-11-23  
> 状态：已实现（方案 1）  
> 基准对齐：MiaoYan `Storage.renameFolder` / `moveFolder` / 侧栏删除（系统废纸篓）  
> 功能清单：`docs/01-feature-inventory.md` A6（P1）

## 1. 目标

让用户在侧栏对**非根**文件夹做四件事：新建、重命名、移动、删除，磁盘结果与列表一致，打开中的笔记路径不丢。

本轮不做：拖拽移动、应用内 Trash、外部修改监听、版本历史跟随、菜单栏 ⇧⌘N（可后补）。

## 2. 已定交互

| 操作 | 交互 |
| --- | --- |
| 新建 | 右键「新建文件夹」（在「全部笔记」或库根语境）/「新建子文件夹」（在某文件夹上）→ 侧栏出现临时行，**行内输入**；Enter 确认，Esc 取消 |
| 重命名 | 右键「重命名」→ 同行内编辑；Enter 确认，Esc 恢复原名 |
| 移动 | 右键「移动到…」→ **应用内文件夹树**选目标（排除自身与子孙）；确认后落盘 |
| 删除 | 右键「移到废纸篓」→ `window.confirm` → 整夹进**系统废纸篓** |

新建父级规则：

- 「新建文件夹」：父目录 = 笔记库根
- 「新建子文件夹」：父目录 = 右键那一行对应的文件夹
- 若父目录当前折叠，创建成功后展开父目录，并选中新建夹

## 3. 架构（方案 1）

```text
Sidebar / ContextMenu / MovePicker
        │ invoke
        ▼
commands.rs  (path 必须 within root)
        │
        ▼
storage.rs   folder_create / folder_rename / folder_move / folder_trash
        │
        ▼
磁盘 rename / create_dir / trash
        │
        ▼
vault_rescan → 前端改写 open / scope / expanded / session
```

原则：

- **先盘后模型**：磁盘成功才改 UI；失败只提示，不半改路径
- **全量 rescan**：与现有笔记命令一致；本阶段无 FSEvents，不维护内存 Project 图
- **路径前缀改写**：重命名/移动后，凡 `oldPath` 或其子孙路径，换成 `newPath` 前缀

## 4. Rust API

均在 `storage.rs` 实现纯函数；`commands.rs` 只做 `VaultState::check` 与调用。

### 4.1 共用校验

`validate_folder_name(name) -> Result<String, String>`：

- `trim` 后非空
- 不含 `/`
- 不为 `.` / `..`
- 拒绝保留名（大小写敏感按磁盘惯例；比较时用原字符串）：`i`、`files`、`Trash`、`.Trash`、`.cache`
- 拒绝以 `.` 开头的名字（扫描本就不收录隐藏夹）

`assert_folder_in_vault(root, path)`：

- `within(root, path)`
- `path != root`（禁止操作库根）
- `path` 是已存在目录（删除/重命名/移动的源）；或创建时父目录已存在

### 4.2 `folder_create(parent, name) -> PathBuf`

- 校验名字
- `parent/name` 不得已存在
- `create_dir`（不 `create_dir_all`：父必须已在库内）
- 返回新夹绝对路径

### 4.3 `folder_rename(path, name) -> PathBuf`

- 校验名字；与当前 `last_component` 相同则原样返回
- 新路径 = `parent/name`；若已存在则报错（不自动加序号，文件夹同名比笔记更危险）
- `fs::rename`；返回新路径

### 4.4 `folder_move(path, destination) -> PathBuf`

- `destination` 必须在库内且是目录
- 拒绝：`destination == path` 或 `destination` 是 `path` 的子孙
- 拒绝：目标下已有同名子项
- 新路径 = `destination / last_component(path)`
- `fs::rename`（同卷原子改名；跨卷失败则返回明确错误，本轮不实现 copy+delete）

### 4.5 `folder_trash(path) -> ()` / `folder_trash_into(path, trash_dir)`

- 与笔记 `trash_into` 同策略：移入系统废纸篓（测试注入 `trash_dir`）
- 废纸篓内同名则加数字后缀（文件夹无 `.md` 扩展名）
- **不做**应用内 `Trash` 文件夹（那是后续 A10）

### 4.6 Tauri 命令名

- `folder_create { parent, name }`
- `folder_rename { path, name }`
- `folder_move { path, destination }`
- `folder_trash { path }`

返回：创建/重命名/移动返回新 `path` 字符串；删除返回 `()`。前端再调 `vault_rescan`。

## 5. 前端

### 5.1 `Sidebar.tsx`

- 行右键 → 上抛 `onContextMenu(event, rowId)`
- 编辑态：某行 `editingId` + 本地 draft；`<input>` 替换标题
- 临时新建行：`draftCreate: { parent, depth }` 插在父节点子级顶部（或「全部笔记」下顶级）

### 5.2 `App.tsx` 菜单项

在「全部笔记」行：

- 新建文件夹
- 在 Finder 中显示（对库根调已有 `reveal`）

在普通文件夹行：

- 新建子文件夹
- 重命名
- 移动到…
- 在 Finder 中显示
- 拷贝路径
- 移到废纸篓（danger）

### 5.3 移动目标选择器

新组件 `FolderMovePicker`（轻量弹层即可）：

- 列出库根 + 全部 `vault.folders`，树形缩进
- 禁用：源自身、源的子孙
- 可选：库根（移到顶级）
- 确认按钮调用 `folder_move`

### 5.4 操作后路径改写

辅助函数 `remapPath(path, from, to)`：

- `path === from` → `to`
- `path.startsWith(from + "/")` → `to + path.slice(from.length)`
- 否则不变

成功后对下列状态批量 remap：`open.meta.path`、`open.meta.folder`、`scope`、`expanded` Set、`session` 里记住的 folder/path。再 `setVault(await rescanVault())`。

删除：若 `scope` 或 `open` 落在被删前缀下，scope 回「全部笔记」，关闭该笔记（先 `flush`）。

### 5.5 删除前保存

若打开笔记路径落在待删/待移文件夹前缀下：先 `flush()`；flush 失败则中止并提示（对齐妙言 `unsavedChanges` 语义的简化版）。

## 6. 错误处理

| 情况 | 用户可见文案（中文） |
| --- | --- |
| 名为空 / 非法 | 文件夹名称无效 |
| 保留名 | 不能使用这个名称 |
| 同名冲突 | 目标位置已有同名文件夹 |
| 移入自身/子孙 | 不能把文件夹移到自己里面 |
| 操作库根 | 不能修改笔记库根目录 |
| 跨卷 rename 失败 | 无法移动文件夹（…系统错误） |
| 废纸篓失败 | 无法移到废纸篓 |

前端：`setError(String(reason))`，与现有保存错误条一致；不静默吞错。

## 7. 测试

`storage.rs` 单测（临时目录，不碰真实废纸篓）：

1. `create` 在根下成功，子夹在父下成功
2. `create` 拒绝保留名、空名、已存在
3. `rename` 改名成功；同名返回原路径；冲突报错
4. `move` 移到另一夹成功；拒绝移入子孙；拒绝目标同名
5. `trash_into` 目录进注入的 trash 目录，源消失

前端：本轮不做组件单测；手测清单见下节。

## 8. 手测清单

1. 在「全部笔记」新建「工作」，侧栏出现并选中
2. 在「工作」下新建子夹「草稿」，父夹自动展开
3. 行内重命名「草稿」→「归档」；打开其中一篇笔记时标题栏路径仍可读
4. 「归档」移动到库根；打开中笔记继续可写可存
5. 尝试把父夹移进自己的子夹 → 报错，树不变
6. 删除「工作」：确认后进废纸篓；若当时选中其下笔记，编辑区关闭，scope 回全部
7. Esc 取消行内新建/重命名，无垃圾目录

## 9. 明确不做（本轮）

- 侧栏拖拽移动 / 从 Finder 拖入
- 应用内 Trash、清空废纸篓、撤销删除 Toast
- `notify` / FSEvents
- 菜单栏「新建文件夹」快捷键
- 文件夹排序偏好、置顶
- 跨卷 copy+delete 回退

## 10. 成功标准

- A6 四项用户路径均可完成
- 打开中笔记在 rename/move 后不指向幽灵路径
- Rust 单测全绿；手测清单 1–7 通过
