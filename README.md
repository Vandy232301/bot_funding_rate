# 🎯 DYNASTY Funding Rate Bot

Production-ready Discord bot for the DYNASTY trading community. Scans all Bybit USDT perpetual pairs in real-time and sends high-accuracy LONG/SHORT alerts based on Funding Rate behavior, technical confirmations, and a scoring system.

## 🚀 Features

- **Real-time Monitoring**: WebSocket-based real-time detection of funding rate and price changes
- **Smart Signal Detection**: 
  - RSI Confluence (RSI > 75 + funding for SHORT, RSI < 30 + funding for LONG)
  - Funding Overextension Reversal
  - Funding Trend Confirmation
  - Funding Divergence Alert
- **Quality Filters**: Monitors only quality tokens (Volume ≥ $1M, Open Interest ≥ $500k)
- **Smart Prioritization**: Scans high-priority symbols first (funding extrem, RSI extrem)
- **Scoring System**: Weighted scoring (0-100) with threshold ≥ 75
- **Discord Integration**: Professional alert cards with TradingView/Bybit links
- **Optimized Performance**: Early exit optimization, batch processing, rate limit protection

## 📋 Requirements

- Node.js 20+
- PostgreSQL 15+ (optional - for signal history)
- Redis 7+ (optional - for cooldowns and rate limiting)
- Bybit API credentials (optional - improves rate limits)
- Discord Webhook URL

## 🛠️ Installation

```bash
# Clone repository
git clone <repository-url>
cd bot_funding_rate

# Install dependencies
npm install

# Copy environment template
cp env.template .env

# Edit .env with your configuration
# - Discord webhook URL
# - Bybit API credentials (optional)
# - Database/Redis settings (optional)
```

## ⚙️ Configuration

Key environment variables in `.env`:

```env
# Discord Webhook (required)
DISCORD_WEBHOOK_URL=your_webhook_url

# Quality Filters
MIN_VOLUME_24H_USDT=1000000         # $1M minimum
MIN_OPEN_INTEREST_USDT=500000       # $500k minimum

# Bot Configuration
MIN_SCORE_THRESHOLD=75              # Minimum score to send alert
COOLDOWN_SECONDS=300                # Cooldown per symbol
MAX_ALERTS_PER_HOUR=20              # Global rate limit
```

## 🚀 Usage

```bash
# Development mode (with watch)
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

## 📊 Strategy Logic

### RSI Confluence (Highest Priority)
- **SHORT**: RSI > 75 + Funding Rate > 0.01%
- **LONG**: RSI < 30 + Funding Rate < -0.01%

### Funding Overextension Reversal
- **SHORT**: Funding ≥ +0.04%, RSI ≥ 70, strong upward momentum
- **LONG**: Funding ≤ -0.04%, RSI ≤ 30, strong downward momentum

### Funding Trend Confirmation
- **LONG**: Funding +0.005% → +0.02%, bullish structure
- **SHORT**: Funding -0.005% → -0.02%, bearish structure

### Funding Divergence
- Price ↑ while Funding ↓ → Distribution risk
- Price ↓ while Funding ↑ → Accumulation risk

## 🧠 Scoring System

| Factor | Weight |
|--------|--------|
| Funding Rate Extremity | 40% |
| Funding Delta/Velocity | 20% |
| RSI/Momentum | 20% |
| Volume Spike | 10% |
| BTC Market Context | 10% |

**Minimum Score: 75** (configurable)

## 📝 License

MIT
