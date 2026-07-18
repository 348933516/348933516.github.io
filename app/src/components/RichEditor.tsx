import { useEffect } from "react";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading1, Heading2, ImagePlus, Italic, Link2, List, ListOrdered, Quote, Redo2, Table2, Undo2 } from "lucide-react";
import { sanitizeHtml } from "../lib/sanitize";

interface RichEditorProps {
  value: string;
  onChange(html: string, text: string, json: Record<string, unknown>): void;
}

export function RichEditor({ value, onChange }: RichEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ allowBase64: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell
    ],
    content: sanitizeHtml(value),
    editorProps: { attributes: { class: "editor-surface" } },
    onUpdate({ editor: current }) {
      onChange(sanitizeHtml(current.getHTML()), current.getText(), current.getJSON() as Record<string, unknown>);
    }
  });

  useEffect(() => {
    if (!editor || editor.getHTML() === value) return;
    editor.commands.setContent(sanitizeHtml(value), false);
  }, [editor, value]);

  if (!editor) return <div className="editor-surface">编辑器加载中...</div>;

  const setLink = () => {
    const previous = editor.getAttributes("link").href || "https://";
    const url = window.prompt("输入链接地址", previous);
    if (!url) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: url, target: "_blank", rel: "noreferrer" }).run();
  };
  const setImage = () => {
    const src = window.prompt("输入已上传图片的 HTTPS 地址");
    if (src) editor.chain().focus().setImage({ src }).run();
  };

  return (
    <div className="editor-shell">
      <div className="editor-toolbar" aria-label="正文编辑工具">
        <button type="button" title="撤销" onClick={() => editor.chain().focus().undo().run()}><Undo2 /></button>
        <button type="button" title="重做" onClick={() => editor.chain().focus().redo().run()}><Redo2 /></button>
        <span />
        <button type="button" className={editor.isActive("heading", { level: 1 }) ? "active" : ""} title="一级标题" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 /></button>
        <button type="button" className={editor.isActive("heading", { level: 2 }) ? "active" : ""} title="二级标题" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></button>
        <button type="button" className={editor.isActive("bold") ? "active" : ""} title="加粗" onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></button>
        <button type="button" className={editor.isActive("italic") ? "active" : ""} title="斜体" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></button>
        <button type="button" title="无序列表" onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></button>
        <button type="button" title="编号列表" onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></button>
        <button type="button" title="引用" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></button>
        <button type="button" title="链接" onClick={setLink}><Link2 /></button>
        <button type="button" title="图片" onClick={setImage}><ImagePlus /></button>
        <button type="button" title="表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 /></button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
