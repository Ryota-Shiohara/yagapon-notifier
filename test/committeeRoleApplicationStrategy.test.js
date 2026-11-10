const assert = require('node:assert/strict');
const {test} = require('node:test');

const {
  ApplicationMessageStrategy,
} = require('../dist/services/messageStrategies/applicationMessageStrategy.js');

test('委員ロール申請は所属・照合状態・Discord利用者を表示する', () => {
  const strategy = new ApplicationMessageStrategy();
  const message = strategy.build({
    event: 'created',
    eventName: '企画長申請',
    applicant: '毛蟹',
    applicationId: 'application-1',
    formType: '委員ロール申請',
    committeeRole: '企画長',
    bureau: 'IT局',
    grade: '２年生',
    discordUserId: '123456789',
    supportUserExists: true,
    status: 'pending',
    description: '企画: ITラボ',
  });

  const embed = message.embeds[0].toJSON();
  assert.equal(embed.title, '【役職申請】企画長');
  assert.match(embed.description, /IT局 \/ ２年生/);
  assert.match(embed.description, /ITラボ/);
  assert.equal(embed.color, 0x008736);
  assert.equal(embed.fields[0].value, '✅ users登録あり');
  assert.match(embed.fields[2].value, /123456789/);
  assert.equal(embed.footer.text, '申請ID: application-1');
});
