import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';
import {
  guessMapping, parseEnergy, parseDate, parsePriceCents, parseDone, toCandidates,
  detectByContent
} from './notion';

/**
 * A CSV parser is exactly the kind of code that looks obviously correct and
 * quietly mangles a tenth of the rows. A personal backlog is full of commas,
 * so `split(',')` would lose or truncate a lot of real to-dos — and the user
 * would only find out months later.
 */

describe('csv parsing', () => {
  it('handles commas inside quoted fields', () => {
    const rows = parseCsv('Name,Project\n"Call Dad, then book flights",Personal');
    expect(rows).toEqual([{ Name: 'Call Dad, then book flights', Project: 'Personal' }]);
  });

  it('handles escaped quotes', () => {
    const rows = parseCsv('Name\n"She said ""no"" twice"');
    expect(rows[0]!.Name).toBe('She said "no" twice');
  });

  it('handles newlines inside quoted fields', () => {
    const rows = parseCsv('Name,Notes\nThing,"line one\nline two"');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Notes).toBe('line one\nline two');
  });

  it('strips the BOM Notion writes', () => {
    // Left in place, the BOM becomes part of the first header name and every
    // lookup of that column silently misses.
    const rows = parseCsv('﻿Name,Project\nThing,Music');
    expect(Object.keys(rows[0]!)).toEqual(['Name', 'Project']);
    expect(rows[0]!.Name).toBe('Thing');
  });

  it('copes with CRLF', () => {
    expect(parseCsv('Name,Project\r\nThing,Music\r\n')).toEqual([
      { Name: 'Thing', Project: 'Music' }
    ]);
  });

  it('ignores trailing blank lines', () => {
    expect(parseCsv('Name\nThing\n\n\n')).toHaveLength(1);
  });

  it('fills missing trailing columns rather than dropping the row', () => {
    const rows = parseCsv('Name,Project,Date\nThing');
    expect(rows[0]).toEqual({ Name: 'Thing', Project: '', Date: '' });
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('column guessing', () => {
  it('finds the usual Notion names', () => {
    const m = guessMapping(['Name', 'Project', 'Difficulty', 'Due date', 'Done'], 'todo');
    expect(m.title).toBe('Name');
    expect(m.project).toBe('Project');
    expect(m.energy).toBe('Difficulty');
    expect(m.date).toBe('Due date');
    expect(m.done).toBe('Done');
  });

  it('falls back to the first column for the title', () => {
    // Notion always exports the title property first, which is far more
    // reliable than hoping someone named it "Name".
    expect(guessMapping(['Taak', 'Wanneer'], 'todo').title).toBe('Taak');
  });

  it('picks up buy columns', () => {
    const m = guessMapping(['Item', 'Link', 'Price'], 'buy');
    expect(m.url).toBe('Link');
    expect(m.price).toBe('Price');
  });
});

describe('value parsing', () => {
  it('maps Notion difficulty onto energy', () => {
    expect(parseEnergy('Quick Win')).toBe('quick');
    expect(parseEnergy('Moderate')).toBe('moderate');
    expect(parseEnergy('Focus')).toBe('focus');
    expect(parseEnergy('')).toBeUndefined();
    expect(parseEnergy('Whatever')).toBeUndefined();
  });

  it('keeps clean ISO dates', () => {
    expect(parseDate('2026-02-14')).toBe('2026-02-14');
  });

  it('drops unparseable dates rather than guessing', () => {
    // A wrong date invents an obligation that never existed, in the one field
    // the app treats as a real commitment.
    expect(parseDate('sometime')).toBeUndefined();
    expect(parseDate('')).toBeUndefined();
  });

  it('refuses year-less Notion dates', () => {
    // The real export is full of these. Date.parse('Mar 22') succeeds and
    // returns some year, so a naive parser would import dozens of stale rows
    // as this year's — every one landing in the past and permanently filling
    // the obligation slot. Keeping the to-do undated is the correct outcome.
    expect(parseDate('Mar 22')).toBeUndefined();
    expect(parseDate('Feb 3')).toBeUndefined();
    expect(parseDate('Feb 3 → Feb 3')).toBeUndefined();
  });

  it('accepts a date once a year is present', () => {
    expect(parseDate('March 22, 2026')).toBe('2026-03-22');
    expect(parseDate('2026-03-22 → 2026-03-25')).toBe('2026-03-22');
  });

  it('parses prices in either decimal style', () => {
    expect(parsePriceCents('€12,50')).toBe(1250);
    expect(parsePriceCents('12.50')).toBe(1250);
    expect(parsePriceCents('$12')).toBe(1200);
    expect(parsePriceCents('')).toBeUndefined();
  });

  it('reads done flags conservatively', () => {
    expect(parseDone('Yes')).toBe(true);
    expect(parseDone('Done')).toBe(true);
    expect(parseDone('In progress')).toBe(false);
    expect(parseDone('')).toBe(false);
  });
});

describe('building candidates', () => {
  it('skips rows with no title', () => {
    // The export is full of empty project pages — 443 files for 124 real
    // records, per the spec's post-mortem.
    const rows = parseCsv('Name,Project\nReal thing,Music\n,Music\n');
    const candidates = toCandidates(rows, { title: 'Name', project: 'Project' });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.title).toBe('Real thing');
  });

  it('carries through the mapped fields', () => {
    const rows = parseCsv('Name,Project,Difficulty,Due\nRestring,Bearfeet,Quick Win,2026-03-01');
    const c = toCandidates(rows, {
      title: 'Name',
      project: 'Project',
      energy: 'Difficulty',
      date: 'Due'
    })[0]!;

    expect(c).toMatchObject({
      title: 'Restring',
      projectName: 'Bearfeet',
      energy: 'quick',
      date: '2026-03-01'
    });
  });
});

describe('identifying columns by their contents', () => {
  it('resolves a uselessly-named column by what is in it', () => {
    // The real export names unconfigured properties "Property", and that one
    // name is a Yes/No flag in the to-do table and a URL in the shopping list.
    // Header matching cannot tell those apart; the values can.
    const buyRows = [
      { name: 'Subwoofer', Property: 'https://thomann.de/x', Checkbox: 'No' },
      { name: 'Lights', Property: 'https://thomann.de/y', Checkbox: 'Yes' }
    ];
    expect(detectByContent(buyRows, ['name', 'Property', 'Checkbox']).urlColumn).toBe('Property');
    expect(detectByContent(buyRows, ['name', 'Property', 'Checkbox']).boolColumn).toBe('Checkbox');

    const todoRows = [
      { Name: 'Edit audio', Property: 'Yes' },
      { Name: 'Email radio', Property: 'No' }
    ];
    expect(detectByContent(todoRows, ['Name', 'Property']).boolColumn).toBe('Property');
    expect(detectByContent(todoRows, ['Name', 'Property']).urlColumn).toBeUndefined();
  });

  it('ignores a boolean column with only one value in it', () => {
    const rows = [{ A: 'x', B: 'No' }, { A: 'y', B: 'No' }];
    expect(detectByContent(rows, ['A', 'B']).boolColumn).toBeUndefined();
  });

  it('feeds content detection into the mapping', () => {
    const rows = [
      { name: 'Subwoofer', Property: 'https://thomann.de/x', Price: '€579.00' },
      { name: 'Lights', Property: 'https://thomann.de/y', Price: '€450.00' }
    ];
    const m = guessMapping(['name', 'Property', 'Price'], 'buy', rows);
    expect(m.url).toBe('Property');
    expect(m.price).toBe('Price');
  });
});
