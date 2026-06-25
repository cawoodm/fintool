import { describe, it, expect, beforeEach } from 'vitest';
import { setItem } from '../js/storage.js';
import {
  SHARE_KEYS, collectConfig, encodeConfig, decodeConfig, diffConfig, maskValue,
} from '../js/share.js';

beforeEach(() => localStorage.clear());

describe('SHARE_KEYS', () => {
  it('is the four config keys in order', () => {
    expect(SHARE_KEYS).toEqual(['github_url', 'github_pat', 'anthropic_key', 'openrouter_key']);
  });
});

describe('collectConfig', () => {
  it('includes only set, non-empty keys', () => {
    setItem('github_url', 'https://github.com/me/data/tree/main/fintool');
    setItem('anthropic_key', 'sk-ant-123');
    setItem('github_pat', ''); // empty -> excluded
    expect(collectConfig()).toEqual({
      github_url: 'https://github.com/me/data/tree/main/fintool',
      anthropic_key: 'sk-ant-123',
    });
  });
  it('returns {} when nothing is set', () => {
    expect(collectConfig()).toEqual({});
  });
});

describe('encodeConfig / decodeConfig round-trip', () => {
  it('preserves values', () => {
    const obj = { github_pat: 'ghp_abc', openrouter_key: 'sk-or-xyz' };
    expect(decodeConfig('#cfg=' + encodeConfig(obj))).toEqual(obj);
  });
  it('handles non-ASCII / URL-special characters', () => {
    const obj = { github_url: 'https://github.com/mé/dätä/tree/main/a b+c?d=e' };
    expect(decodeConfig('#cfg=' + encodeConfig(obj))).toEqual(obj);
  });
  it('keeps only known SHARE_KEYS, dropping unknown fields', () => {
    const enc = encodeConfig({ github_pat: 'ghp_x', evil: 'nope' });
    expect(decodeConfig('#cfg=' + enc)).toEqual({ github_pat: 'ghp_x' });
  });
  it('drops keys whose value is an empty string (never carries blanks)', () => {
    const enc = encodeConfig({ github_pat: 'ghp_x', anthropic_key: '' });
    expect(decodeConfig('#cfg=' + enc)).toEqual({ github_pat: 'ghp_x' });
  });
});

describe('decodeConfig returns null on malformed input', () => {
  it.each([
    ['empty string', ''],
    ['hash with no cfg', '#nothing'],
    ['invalid base64', '#cfg=not base64!!'],
  ])('%s', (_label, input) => {
    expect(decodeConfig(input)).toBeNull();
  });
  it('non-JSON payload', () => {
    // base64url of 'not json' is bm90IGpzb24
    expect(decodeConfig('#cfg=bm90IGpzb24')).toBeNull();
  });
  it('wrong version', () => {
    // base64url of a v:2 payload — manually built so we bypass encodeConfig's v:1 stamp.
    const bad = Buffer.from(JSON.stringify({ v: 2, github_pat: 'x' })).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeConfig('#cfg=' + bad)).toBeNull();
  });
  it('valid v=1 but no known keys', () => {
    const enc = encodeConfig({}); // {v:1}
    expect(decodeConfig('#cfg=' + enc)).toBeNull();
  });
});

describe('diffConfig', () => {
  it('classifies new / overwrite / unchanged against storage', () => {
    setItem('github_pat', 'old-pat');     // will differ -> overwrite
    setItem('anthropic_key', 'same-key'); // identical -> unchanged
    const d = diffConfig({
      github_pat: 'new-pat',
      anthropic_key: 'same-key',
      openrouter_key: 'brand-new',        // not set -> new
    });
    expect(d.overwrite).toEqual(['github_pat']);
    expect(d.unchanged).toEqual(['anthropic_key']);
    expect(d.new).toEqual(['openrouter_key']);
  });
});

describe('maskValue', () => {
  it('masks secrets keeping head and tail', () => {
    expect(maskValue('github_pat', 'ghp_secret1234')).toBe('ghp_•••1234');
  });
  it('fully dots short secrets', () => {
    expect(maskValue('anthropic_key', 'short')).toBe('•••');
  });
  it('shows github_url in full', () => {
    expect(maskValue('github_url', 'https://github.com/me/data')).toBe('https://github.com/me/data');
  });
});
