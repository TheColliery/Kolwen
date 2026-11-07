# Reply to a request for seller information (Japan)

**PRELIMINARY: counsel has not read this text.** It is the working wording of one reply, not a legal opinion.

## What this is

The reply Kolwen sends when a customer in Japan asks for the seller details that the Act on Specified Commercial Transactions (特定商取引に関する法律, "the Act") lets an online seller leave off its page. The Act allows that only where the page states that the details are given on request without delay (Act Art. 11, proviso); the ordinance (Arts. 23 and 25) sets which details may be left off. This file is the only place the wording of the reply lives. Nothing else in the repository repeats it.

## The request route

- A customer asks by e-mail to `info@kolwen.com`.
- The seller page, when one exists, states that the details are given on request without delay.
- No fee and no login are required.

## When the reply goes

Without delay, and early enough for the customer to decide before ordering. The Consumer Affairs Agency's guidance says 「申込みの意思決定に先立って十分な時間的余裕をもって提供されること」 (provided with sufficient time to decide before ordering). No hour figure is set here.

## The reply

Japanese:

```
件名: 販売業者情報のご請求について

お問い合わせいただいた販売業者の情報をお知らせいたします。

販売業者の氏名（名称）: {{seller_legal_name}}
住所: {{seller_address}}
電話番号: {{seller_phone}}
電話対応時間: {{contact_hours}}

ご不明な点は、このメールへのご返信でお問い合わせください。
```

English:

```
Subject: Seller information you requested

Thank you for your request. The seller information you asked for is below.

Seller name (legal name): {{seller_legal_name}}
Address: {{seller_address}}
Telephone: {{seller_phone}}
Telephone hours: {{contact_hours}}

If you have a question, reply to this e-mail.
```

## Where the values come from

Each value is filled at reply time from a private record that the maintainer keeps outside this repository and outside every public system. The record is not named here and holds no value in this file.

## The address

Until an office exists, the maintainer's home address and telephone number are used in `{{seller_address}}` and `{{seller_phone}}`. When an office is set up, only the private record changes. This file does not change.
