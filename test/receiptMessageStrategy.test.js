const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  ReceiptMessageStrategy,
} = require('../dist/services/messageStrategies/receiptMessageStrategy.js');

function createData(event = 'created') {
  return {
    event,
    organizationId: 'organization-1',
    submissionId: 'submission-1',
    organizationName: 'テスト団体',
    eventName: 'テスト企画',
    applicant: '申請 太郎',
    submittedAt: '2026-08-02T10:00:00+09:00',
    occurredAt: '2026-08-02T10:00:05+09:00',
    items: [
      {
        itemName: '養生テープ',
        actualPrice: 1280,
        wasActuallyPurchased: true,
      },
      {
        itemName: '購入しなかった物品',
        actualPrice: 5000,
        wasActuallyPurchased: false,
      },
    ],
    receiptFiles: [
      {
        fileName: 'receipt.pdf',
        webViewLink: 'https://drive.example.test/receipt',
      },
    ],
  };
}

function fieldValue(embed, name) {
  return embed.fields.find((field) => field.name === name)?.value;
}

test('購入済み品だけで件数・合計・購入品を表示する', () => {
  const strategy = new ReceiptMessageStrategy();
  const message = strategy.build(createData(), 'receipt-role-id');
  const embed = message.embeds[0].toJSON();

  assert.equal(message.content, '<@&receipt-role-id>');
  assert.equal(embed.title, '【新規】領収書提出');
  assert.equal(fieldValue(embed, '購入件数'), '1件');
  assert.equal(fieldValue(embed, '合計金額'), '¥1,280');
  assert.match(fieldValue(embed, '購入品'), /養生テープ/);
  assert.doesNotMatch(fieldValue(embed, '購入品'), /購入しなかった物品/);
});

test('編集表示と領収書ファイルへのリンクを構築する', () => {
  const strategy = new ReceiptMessageStrategy();
  const message = strategy.build(createData('edited'));
  const embed = message.embeds[0].toJSON();

  assert.equal(message.content, '');
  assert.equal(embed.title, '【編集】領収書提出');
  assert.match(
    fieldValue(embed, '領収書'),
    /\[receipt\.pdf\]\(https:\/\/drive\.example\.test\/receipt\)/
  );
});
