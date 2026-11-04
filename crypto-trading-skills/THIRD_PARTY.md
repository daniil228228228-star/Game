# Сторонние инструменты (код здесь НЕ скопирован, только ссылки и вердикты)

Проверено чтением кода (без запуска, если не указано иное). Всё ставится у вас, а не здесь.

| Инструмент | Что это | Вердикт |
|---|---|---|
| [syedishaq7262-svg/crypto-trader-skill](https://github.com/syedishaq7262-svg/crypto-trader-skill) | 18 скиллов для крипто-дейтрейдинга (Binance/Bybit/Hyperliquid) | Код безопасен по чтению; один коммит, сделан ИИ. **Бэктест авторов: -0.17R за сделку после издержек, edge нет.** Полезны: idealab, risk, liquidation, budget, journal |
| [marketcalls/vectorbt-backtesting-skills](https://github.com/marketcalls/vectorbt-backtesting-skills) | Скиллы для бэктеста на VectorBT, правила издержек для крипты, walk-forward | Хорошо для проверки идей; ориентирован на Индию/США, `requirements.txt` в UTF-16; `/setup` качает TA-Lib по HTTP |
| [shakeebshaan/claude-code-quant-skills](https://github.com/shakeebshaan/claude-code-quant-skills) | 6 текстовых скиллов: backtest-review, strategy-critique и др. | Только промпты, безопасно; полезный "скептик" |
| [bybit-exchange/skills](https://github.com/bybit-exchange/skills) | Официальный скилл Bybit (торговля на естественном языке) | Ставить **у себя**, не в песочнице; AI-субаккаунт, ключ без вывода, сначала testnet. Есть автообновление |
| [shiyu-coder/Kronos](https://github.com/shiyu-coder/Kronos) | Модель свечей (AAAI 2026) | **Тест: на 24ч угадывает направление 49%, корреляция -0.02 (210 прогнозов).** Не сигнал |
| Chronos-2 (amazon/chronos-2), TimesFM 2.5 (google) | Модели временных рядов | **Тест на тех же точках: 48-53%, корреляция в пределах шума.** Не сигнал |
| Freqtrade / Hummingbot (+ MCP) | Боты | Не проверялись; зрелые проекты, но сами по себе edge не дают |
| `walt-trading` MCP (`walletbot.me`) | Неизвестный удалённый MCP, возможно связан с Telegram Wallet | **Не подключали.** Домен без документации; может получить доступ к торговле с кошелька |

Установка скиллов вручную (на своём компьютере):
```bash
git clone https://github.com/shakeebshaan/claude-code-quant-skills && cp -r claude-code-quant-skills/skills/* ~/.claude/skills/
git clone https://github.com/marketcalls/vectorbt-backtesting-skills && cp -r vectorbt-backtesting-skills/.claude/skills/* ~/.claude/skills/
git clone https://github.com/bybit-exchange/skills ~/.claude/skills/bybit-trading
```
