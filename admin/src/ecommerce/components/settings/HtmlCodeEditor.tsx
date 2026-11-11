import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useTheme } from 'styled-components';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';

export type HtmlCodeEditorHandle = {
  /** Replaces the selection (or inserts at the cursor) with `snippet` and focuses the editor. */
  insert: (snippet: string) => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
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

const HtmlCodeEditor = forwardRef<HtmlCodeEditorHandle, Props>(
  ({ value, onChange, onFocus, readOnly = false, label }, ref) => {
    const theme = useTheme();
    const viewRef = useRef<EditorView | null>(null);
    const extensions = useMemo(
      () => [
        html(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.domEventHandlers({ focus: () => onFocus?.() }),
      ],
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [label]
    );

    useImperativeHandle(ref, () => ({
      insert: (snippet: string) => {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: snippet },
          selection: { anchor: from + snippet.length },
          scrollIntoView: true,
        });
        view.focus();
      },
    }));

    return (
      <CodeMirror
        value={value}
        onChange={onChange}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
        extensions={extensions}
        theme={isDarkColor(theme?.colors?.neutral0) ? 'dark' : 'light'}
        editable={!readOnly}
        readOnly={readOnly}
        minHeight="480px"
        basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly }}
        style={{ fontSize: 13, borderRadius: 4, overflow: 'hidden' }}
      />
    );
  }
);

HtmlCodeEditor.displayName = 'HtmlCodeEditor';

export { HtmlCodeEditor };
