import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useTheme } from 'styled-components';
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { isDarkColor } from '../../utils/statusBadges';

type Props = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  label: string;
  /** A fixed height (the editor scrolls inside it); without it the editor grows with the text. */
  height?: string;
  /** The caret moved in the editor (by the user): its offset in the source. */
  onCursor?: (offset: number) => void;
};

export type HtmlCodeEditorHandle = {
  /** Selects the source range and scrolls it to the editor's middle, without taking the focus. */
  reveal: (from: number, to: number) => void;
};

const HtmlCodeEditor = forwardRef<HtmlCodeEditorHandle, Props>(
  ({ value, onChange, readOnly = false, label, height, onCursor }, ref) => {
    const theme = useTheme();
    const editor = useRef<ReactCodeMirrorRef>(null);
    const extensions = useMemo(
      () => [
        html(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': label }),
      ],
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [label]
    );

    useImperativeHandle(ref, () => ({
      reveal(from, to) {
        const view = editor.current?.view;
        if (!view) return;
        const length = view.state.doc.length;
        const anchor = Math.max(0, Math.min(from, length));
        const head = Math.max(anchor, Math.min(to, length));
        view.dispatch({
          selection: { anchor, head },
          effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
        });
      },
    }));

    return (
      <CodeMirror
        ref={editor}
        value={value}
        onChange={onChange}
        // Only the user's own moves (the editor has the focus), not a reveal from the preview.
        onUpdate={(update) => {
          if (onCursor && update.selectionSet && update.view.hasFocus) {
            onCursor(update.state.selection.main.head);
          }
        }}
        extensions={extensions}
        theme={isDarkColor(theme?.colors?.neutral0) ? 'dark' : 'light'}
        editable={!readOnly}
        readOnly={readOnly}
        height={height}
        minHeight={height ? undefined : '480px'}
        basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly }}
        style={{ fontSize: 13, borderRadius: 4, overflow: 'hidden', ...(height === '100%' ? { height: '100%' } : {}) }}
      />
    );
  }
);

HtmlCodeEditor.displayName = 'HtmlCodeEditor';

export { HtmlCodeEditor };
