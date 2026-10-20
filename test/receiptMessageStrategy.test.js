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
        budgetItemId: 'budget-item-1',
        itemName: '養生テープ',
        actualPrice: 1280,
        purpose: '設営',
        companyName: 'テスト商店',
        wasActuallyPurchased: true,
      },
      {
        budgetItemId: 'budget-item-2',
        itemName: '購入しなかった物品',
        actualPrice: 5000,
        purpose: '未使用',
        companyName: '別の商店',
        wasActuallyPurchased: false,
      },
    ],
    receiptFiles: [
      {
        fileId: 'drive-file-1',
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
  assert.match(fieldValue(embed, '購入品'), /購入目的: 設営/);
  assert.match(fieldValue(embed, '購入品'), /企業名: テスト商店/);
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

test('カード明細更新は更新日時とファイルへのリンクを表示する', () => {
  const data = createData('cardStatementUpdated');
  data.cardStatementFiles = [
    {
      fileId: 'statement-1',
      fileName: 'statement.pdf',
      webViewLink: 'https://example.test/statement',
    },
  ];
  const embed = new ReceiptMessageStrategy().build(data).embeds[0].toJSON();
  assert.equal(embed.title, '【更新】クレジットカード明細');
  assert.equal(
    fieldValue(embed, '更新日時'),
    `<t:${Math.floor(new Date(data.occurredAt).getTime() / 1000)}:F>`
  );
  assert.equal(
    fieldValue(embed, 'クレジットカード明細'),
    '• [statement.pdf](https://example.test/statement)'
  );
});

test('領収書と同時更新されたカード明細も表示する', () => {
  const data = createData('edited');
  data.cardStatementFiles = [
    {
      fileId: '1',
      fileName: '明細.pdf',
      webViewLink: 'https://example.test/card',
    },
  ];
  const embed = new ReceiptMessageStrategy().build(data).embeds[0].toJSON();
  assert.equal(embed.title, '【編集】領収書提出');
  assert.match(
    fieldValue(embed, 'クレジットカード明細'),
    /https:\/\/example.test\/card/
  );
});

test('カード明細を全削除した場合とリンクがない場合も表示できる', () => {
  const data = createData('cardStatementUpdated');
  data.cardStatementFiles = [];
  const strategy = new ReceiptMessageStrategy();
  assert.equal(
    fieldValue(strategy.build(data).embeds[0].toJSON(), 'クレジットカード明細'),
    'カード明細ファイルはありません。'
  );
  data.cardStatementFiles = [
    { fileId: '1', fileName: '明細.pdf', webViewLink: 'javascript:alert(1)' },
  ];
  assert.equal(
    fieldValue(strategy.build(data).embeds[0].toJSON(), 'クレジットカード明細'),
    '• 明細.pdf（リンクなし）'
  );
});
