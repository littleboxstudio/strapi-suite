import { useMemo } from 'react';
import { useTheme } from 'styled-components';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';

type Props = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  label: string;
};

/** Strapi's dark theme has a dark neutral0; anything else is the light theme. */
const isDarkColor = (hex: string | undefined) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!match) return false;
  const n = parseInt(match[1], 16);
  const luminance = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return luminance < 128;
};

const HtmlCodeEditor = ({ value, onChange, readOnly = false, label }: Props) => {
  const theme = useTheme();
  const extensions = useMemo(
    () => [
      html(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': label }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [label]
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={isDarkColor(theme?.colors?.neutral0) ? 'dark' : 'light'}
      editable={!readOnly}
      readOnly={readOnly}
      minHeight="480px"
      basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly }}
      style={{ fontSize: 13, borderRadius: 4, overflow: 'hidden' }}
    />
  );
};

export { HtmlCodeEditor };
