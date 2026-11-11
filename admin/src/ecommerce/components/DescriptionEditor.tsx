import { useEffect, useRef } from 'react';
import styled from 'styled-components';
import { Box, Flex, IconButton } from '@strapi/design-system';
import { Bold as BoldIcon, Italic as ItalicIcon, Underline as UnderlineIcon } from '@strapi/icons';
import { EditorContent, useEditor } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';

// Only these extensions exist in the schema, so anything else pasted (links, lists, headings,
// images, colours) is reduced to plain paragraphs and text. The server sanitizes again.
const EXTENSIONS = [Document, Paragraph, Text, HardBreak, Bold, Italic, Underline];

type Props = {
  id: string;
  value: string;
  onChange: (html: string) => void;
  hasError?: boolean;
  labels: { bold: string; italic: string; underline: string };
  ariaLabelledBy?: string;
};

const Frame = styled(Box)<{ $hasError?: boolean }>`
  border: 1px solid
    ${({ theme, $hasError }) => ($hasError ? theme.colors.danger600 : theme.colors.neutral200)};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral0};

  &:focus-within {
    border-color: ${({ theme }) => theme.colors.primary600};
    box-shadow: ${({ theme }) => theme.colors.primary600} 0 0 0 2px;
  }

  .ProseMirror {
    min-height: 140px;
    padding: 12px 16px;
    outline: none;
    font-size: ${({ theme }) => theme.fontSizes[2]};
    line-height: 1.5;
    color: ${({ theme }) => theme.colors.neutral800};
  }

  .ProseMirror p {
    margin: 0 0 8px;
  }

  .ProseMirror p:last-child {
    margin-bottom: 0;
  }

  .ProseMirror strong {
    font-weight: 600;
  }

  .ProseMirror em {
    font-style: italic;
  }

  .ProseMirror u {
    text-decoration: underline;
  }
`;

/** The editor's HTML, with an empty document reported as ''. */
const currentHtml = (editor: { isEmpty: boolean; getHTML: () => string }) =>
  editor.isEmpty ? '' : editor.getHTML();

const DescriptionEditor = ({ id, value, onChange, hasError, labels, ariaLabelledBy }: Props) => {
  // The editor is created once; keep the latest callback without recreating it.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: value,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        ...(ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : {}),
      },
    },
    onUpdate: ({ editor: e }) => onChangeRef.current(currentHtml(e)),
  });

  // External changes (locale switch, AI translation, product loaded) replace the content.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value !== currentHtml(editor)) editor.commands.setContent(value, false);
  }, [editor, value]);

  const marks = [
    {
      name: 'bold',
      label: labels.bold,
      icon: <BoldIcon />,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      name: 'italic',
      label: labels.italic,
      icon: <ItalicIcon />,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      name: 'underline',
      label: labels.underline,
      icon: <UnderlineIcon />,
      run: () => editor?.chain().focus().toggleUnderline().run(),
    },
  ];

  return (
    <Frame $hasError={hasError}>
      <Flex
        gap={1}
        padding={1}
        borderColor="neutral200"
        style={{ borderBottomWidth: 1, borderBottomStyle: 'solid' }}
      >
        {marks.map((mark) => {
          const active = editor?.isActive(mark.name) ?? false;
          return (
            <IconButton
              key={mark.name}
              label={mark.label}
              variant={active ? 'secondary' : 'ghost'}
              aria-pressed={active}
              disabled={!editor}
              onClick={mark.run}
            >
              {mark.icon}
            </IconButton>
          );
        })}
      </Flex>
      <EditorContent editor={editor} />
    </Frame>
  );
};

export { DescriptionEditor };
