import { useMemo } from 'react';
import { useTheme } from 'styled-components';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { isDarkColor } from '../../utils/statusBadges';

type Props = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  label: string;
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
