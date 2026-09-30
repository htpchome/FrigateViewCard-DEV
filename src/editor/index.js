import {
  CARD_EDITOR_TAG,
  SUPPORTED_CARD_EDITOR_TAGS,
} from "../constants.js";
import { FrigateViewCardEditor } from "./FrigateViewCardEditor.js";

if (!customElements.get(CARD_EDITOR_TAG)) {
  customElements.define(CARD_EDITOR_TAG, FrigateViewCardEditor);
}
for (const editorTag of SUPPORTED_CARD_EDITOR_TAGS) {
  if (!customElements.get(editorTag)) {
    customElements.define(editorTag, class extends FrigateViewCardEditor {});
  }
}
