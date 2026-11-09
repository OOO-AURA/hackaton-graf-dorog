export type Tags = Readonly<Record<string, string>>;
/** Attributes other than id/lat/lon (version, timestamp, user...) kept verbatim for lossless export. */
export type Attrs = Readonly<Record<string, string>>;

export interface OsmNode {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly tags: Tags;
  readonly attrs: Attrs;
}

export interface OsmWay {
  readonly id: string;
  readonly refs: readonly string[];
  readonly tags: Tags;
  readonly attrs: Attrs;
}

export interface OsmMember {
  readonly type: 'node' | 'way' | 'relation';
  readonly ref: string;
  readonly role: string;
}

export interface OsmRelation {
  readonly id: string;
  readonly members: readonly OsmMember[];
  readonly tags: Tags;
  readonly attrs: Attrs;
}

export interface OsmDoc {
  readonly rootAttrs: Attrs;
  readonly bounds: Attrs | null;
  readonly nodes: Readonly<Record<string, OsmNode>>;
  readonly ways: Readonly<Record<string, OsmWay>>;
  readonly relations: Readonly<Record<string, OsmRelation>>;
  /** Next id for created objects. New ids are positive and above every existing id so all importers accept them. */
  readonly nextId: number;
  /** Keys like "way:123" of objects deleted in the editor; relation members pointing at them are dropped on export. */
  readonly deleted: Readonly<Record<string, true>>;
}

export const EMPTY_DOC: OsmDoc = {
  rootAttrs: { version: '0.6' },
  bounds: null,
  nodes: {},
  ways: {},
  relations: {},
  nextId: 1,
  deleted: {},
};
