import { describe, it, expect } from 'vitest';
import {
  isCandidateFile,
  matchAccountFolder,
  outcomePath,
} from '../src/domain/imports/watch-folder-core.js';

describe('isCandidateFile', () => {
  it('accepts the three importable extensions (case-insensitive)', () => {
    expect(isCandidateFile('releve.ofx')).toBe(true);
    expect(isCandidateFile('releve.OFX')).toBe(true);
    expect(isCandidateFile('releve.qfx')).toBe(true);
    expect(isCandidateFile('export.csv')).toBe(true);
    expect(isCandidateFile('statement.pdf')).toBe(true);
  });

  it('rejects unknown extensions, dotfiles, and already-processed outcomes', () => {
    expect(isCandidateFile('notes.txt')).toBe(false);
    expect(isCandidateFile('photo.jpg')).toBe(false);
    expect(isCandidateFile('.DS_Store')).toBe(false);
    expect(isCandidateFile('.hidden.ofx')).toBe(false);
    expect(isCandidateFile('releve.ofx.imported')).toBe(false);
    expect(isCandidateFile('releve.pdf.failed')).toBe(false);
    expect(isCandidateFile('releve.pdf.needs-template')).toBe(false);
    expect(isCandidateFile('releve.pdf.error.txt')).toBe(false);
  });
});

describe('matchAccountFolder', () => {
  const accounts = [
    { id: 1, userId: 10, name: 'Compte courant' },
    { id: 2, userId: 10, name: 'Livret A' },
    { id: 3, userId: 20, name: 'Épargne Éloïse' },
  ];

  it('matches case- and accent-insensitively', () => {
    expect(matchAccountFolder('compte courant', accounts)).toEqual({ kind: 'ok', accountId: 1, userId: 10 });
    expect(matchAccountFolder('COMPTE COURANT', accounts)).toEqual({ kind: 'ok', accountId: 1, userId: 10 });
    expect(matchAccountFolder('epargne eloise', accounts)).toEqual({ kind: 'ok', accountId: 3, userId: 20 });
    expect(matchAccountFolder('  Livret A ', accounts)).toEqual({ kind: 'ok', accountId: 2, userId: 10 });
  });

  it('reports unmatched folders', () => {
    expect(matchAccountFolder('inconnu', accounts)).toEqual({ kind: 'unmatched' });
  });

  it('reports collisions instead of guessing (same name across users)', () => {
    const colliding = [...accounts, { id: 4, userId: 20, name: 'compte COURANT' }];
    expect(matchAccountFolder('compte courant', colliding)).toEqual({ kind: 'collision' });
  });
});

describe('outcomePath', () => {
  it('appends the outcome suffix to the full path', () => {
    expect(outcomePath('/watch/Compte courant/mai.ofx', 'imported')).toBe('/watch/Compte courant/mai.ofx.imported');
    expect(outcomePath('/watch/a/b.pdf', 'failed')).toBe('/watch/a/b.pdf.failed');
    expect(outcomePath('/watch/a/b.pdf', 'needs-template')).toBe('/watch/a/b.pdf.needs-template');
  });
});
