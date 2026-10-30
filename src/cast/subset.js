// One cast member's script: only the lines they say, from the whole play. Made on the laptop when
// the packs are built, so a phone never holds anyone else's part. Items keep their place in the play
// (index and scene), so "next to each other" still means next to each other on stage: a line after
// someone else's always gets its cue. Longer cues compare neighbours, so they are worked out on the
// whole play here and saved with the model.
import { fnv1a, makeBeats, uniqueCues } from '../items.js';

export function memberModel(model, ids, { self = null } = {}) {
  const wanted = new Set(ids);
  const cues = uniqueCues(model);
  const items = model.items.filter((it) => wanted.has(it.id)).map((it) => ({ ...it, askSpeaker: it.part === 0 && it.speaker !== self }));
  const beats = [];
  const scenes = model.scenes.map((sc) => {
    const own = items.filter((it) => it.scene === sc.index);
    const beatIds = [];
    for (const group of makeBeats(own)) {
      const beat = { id: 'b' + group[0].id, scene: sc.index, itemIds: group.map((it) => it.id), words: group.reduce((n, it) => n + it.words, 0) };
      group.forEach((it) => (it.beat = beat.id));
      beats.push(beat);
      beatIds.push(beat.id);
    }
    return {
      ...sc,
      itemIds: own.map((it) => it.id),
      beatIds,
      words: own.reduce((n, it) => n + it.words, 0),
      reader: sc.reader.filter((r) => r.t === 'speech' && r.itemIds.some((id) => wanted.has(id))),
    };
  });
  return {
    version: model.version,
    hash: fnv1a(`${model.hash}|${items.map((it) => it.id).join(',')}`),
    scenes,
    items,
    beats,
    cues: Object.fromEntries(items.filter((it) => cues.has(it.id)).map((it) => [it.id, cues.get(it.id)])),
    totals: {
      speeches: scenes.reduce((n, s) => n + s.reader.length, 0),
      words: items.reduce((n, it) => n + it.words, 0),
      items: items.length,
      beats: beats.length,
    },
  };
}
