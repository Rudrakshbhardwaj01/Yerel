import { describe, expect, it } from 'vitest';
import { validateLocalTarget } from '../shared/target';
describe('local target rules', () => {
  it('normalizes a localhost target', () => expect(validateLocalTarget('localhost:5173')).toMatchObject({ url: 'http://localhost:5173', port: 5173 }));
  it('accepts IPv6 loopback', () => expect(validateLocalTarget('http://[::1]:5173')).toMatchObject({ port: 5173, host: '::1' }));
  it('rejects remote targets', () => expect(() => validateLocalTarget('https://example.com')).toThrow('localhost'));
  it('rejects invalid ports', () => expect(() => validateLocalTarget('localhost:99999')).toThrow('valid local'));
  it('rejects credentials, fragments, and unsafe protocols', () => { expect(() => validateLocalTarget('http://user:pass@localhost:80')).toThrow('Credentials'); expect(() => validateLocalTarget('http://localhost:80/#x')).toThrow('fragments'); expect(() => validateLocalTarget('file:///tmp/x')).toThrow('HTTP'); });
});
