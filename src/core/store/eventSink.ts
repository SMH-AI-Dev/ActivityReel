import type {
  ActivityEvent,
  DiffPayload,
  EventDraft,
  EventProgressPatch,
} from "../../shared/model";

/** The only write surface trackers may use; keeps event identity/seq concerns in the store. */
export interface EventSink {
  append(draft: EventDraft): ActivityEvent;
  update(id: string, patch: EventProgressPatch): ActivityEvent | undefined;
  attachDiff(id: string, payload: DiffPayload): void;
  get(id: string): ActivityEvent | undefined;
}
