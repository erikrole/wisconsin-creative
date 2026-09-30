import base from '/Users/role/Code/wisconsin-creative/vitest.config.ts';
export default {
  ...base,
  plugins: [{
    name: 'audit-passkey-boundary',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.endsWith('/tests/passkey-auth.test.ts')) return;
      const marker = 'it("does not accept a ceremony that has already been consumed", async () => {';
      const at = code.indexOf(marker);
      if (at < 0) throw new Error('Audit target moved');
      let tail = code.slice(at).replace('expect(response.status).toBe(401);', 'expect(dbMock.passkeyChallenge.deleteMany).toHaveBeenCalledTimes(1);\n    expect(response.status).toBe(401);');
      if (process.env.WC_AUDIT_FIX_FIXTURE === '1') tail = tail.replace(marker, marker + '\n    dbMock.user.findUnique.mockResolvedValue({ ...user, active: true, collaboratorPolicy: null });');
      return code.slice(0, at) + tail;
    }
  }]
};
