import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const COLORS = ["#00d4ff", "#ff6b6b", "#ffd93d", "#6bcb77", "#c77dff", "#ff9a3c", "#4cc9f0", "#f72585", "#b5e48c", "#48cae4"];
const GEMINI_MODEL = "gemini-2.5-flash";
const PRICE_REFRESH_INTERVAL = 60000;

// ── API helpers ────────────────────────────────────────────────────────────────
async function callGemini(messages, system = "", maxTokens = 1000) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("VITE_GEMINI_API_KEY environment variable not set");
  }

  // Format messages for Gemini (roles must be 'user' or 'model')
  const formattedMessages = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const payload = {
    contents: formattedMessages,
    generationConfig: { maxOutputTokens: maxTokens }
  };

  if (system) {
    payload.systemInstruction = { parts: [{ text: system }] };
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callGeminiWithSearch(messages, system = "", maxTokens = 1200) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("VITE_GEMINI_API_KEY environment variable not set");
  }

  const formattedMessages = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const payload = {
    contents: formattedMessages,
    generationConfig: { maxOutputTokens: maxTokens },
    tools: [{ googleSearch: {} }] // Enable Google Search grounding
  };

  if (system) {
    payload.systemInstruction = { parts: [{ text: system }] };
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function fetchPricesForTickers(tickers) {
  if (!tickers.length) return {};
  const list = tickers.join(", ");
  try {
    const text = await callGeminiWithSearch(
      [{ role: "user", content: `Search for the current stock price and today's percentage change for each of these tickers: ${list}.\nReturn ONLY a JSON object like: {"AAPL":{"price":182.50,"change":1.23},"TSLA":{"price":245.10,"change":-0.87}}\nUse exact ticker symbols as keys. "change" is day's % change as a number.` }],
      "You are a financial data assistant. Return ONLY valid JSON, no markdown, no explanation."
    );
    const clean = text.replace(/```[a-z]*\n?/gi, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) { console.error("Price fetch error", e); }
  return {};
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function Verdict({ text }) {
  if (!text) return null;
  const upper = text.toUpperCase();
  const isSell = upper.includes("SELL THE CALL") && !upper.includes("DO NOT") && !upper.includes("DON'T") && !upper.includes("AVOID") && !upper.includes("HOLD OFF") && !upper.includes("SKIP");
  const isHold = upper.includes("HOLD OFF") || upper.includes("DO NOT SELL") || upper.includes("DON'T SELL") || upper.includes("AVOID SELLING") || upper.includes("SKIP");
  const color = isSell ? "#3fb950" : isHold ? "#f85149" : "#ffd93d";
  const label = isSell ? "✓ SELL THE CALL" : isHold ? "✗ HOLD OFF THIS WEEK" : "~ NEUTRAL — REVIEW CAREFULLY";
  return <div style={{ display: "inline-block", background: color + "18", border: `1px solid ${color}`, color, borderRadius: 20, padding: "6px 18px", fontSize: 11, fontWeight: 700, letterSpacing: "2px", marginBottom: 14 }}>{label}</div>;
}

function LivePrice({ priceData, loading }) {
  const [flash, setFlash] = useState(null);
  const prevPrice = useRef(null);
  useEffect(() => {
    if (!priceData?.price) return;
    if (prevPrice.current !== null && priceData.price !== prevPrice.current) {
      setFlash(priceData.price > prevPrice.current ? "up" : "down");
    }
    prevPrice.current = priceData.price;
  }, [priceData?.price]);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(timer);
  }, [flash]);
  if (loading) return <span style={{ fontSize: 11, color: "#484f58", fontStyle: "italic" }}>fetching...</span>;
  if (!priceData?.price) return <span style={{ fontSize: 11, color: "#484f58" }}>—</span>;
  const { price, change } = priceData;
  const isUp = change >= 0;
  const cc = isUp ? "#3fb950" : "#f85149";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: flash === "up" ? "#3fb95030" : flash === "down" ? "#f8514930" : "transparent", borderRadius: 4, padding: "2px 6px", transition: "background 0.3s ease" }}>
      <span style={{ color: "#e6edf3", fontWeight: 700, fontSize: 13 }}>${price.toFixed(2)}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: cc, background: cc + "18", borderRadius: 3, padding: "1px 5px" }}>{isUp ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%</span>
    </span>
  );
}

// Typing animation dots
function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center", padding: "2px 0" }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "#58a6ff", display: "inline-block", animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
      ))}
    </span>
  );
}

// Render chat message — supports basic markdown-like bold (**text**)
function ChatMessage({ msg }) {
  const isUser = msg.role === "user";
  const renderText = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} style={{ color: "#e6edf3" }}>{part.slice(2, -2)}</strong>;
      }
      return part.split("\n").map((line, j, arr) => (
        <span key={`${i}-${j}`}>{line}{j < arr.length - 1 ? <br /> : null}</span>
      ));
    });
  };

  return (
    <div style={{
      display: "flex", flexDirection: isUser ? "row-reverse" : "row",
      gap: 10, alignItems: "flex-start", marginBottom: 16,
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
        background: isUser ? "#1f6feb" : "#1a3a1e",
        border: `1px solid ${isUser ? "#388bfd" : "#238636"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, color: isUser ? "#79c0ff" : "#3fb950", fontWeight: 700,
      }}>
        {isUser ? "U" : "AI"}
      </div>
      <div style={{
        maxWidth: "78%",
        background: isUser ? "#1f3a5f" : "#161b22",
        border: `1px solid ${isUser ? "#388bfd30" : "#30363d"}`,
        borderRadius: isUser ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
        padding: "12px 16px",
        fontSize: 13, color: "#c9d1d9", lineHeight: 1.75,
      }}>
        {msg.typing ? <TypingDots /> : renderText(msg.content)}
        {msg.timestamp && !msg.typing && (
          <div style={{ fontSize: 10, color: "#484f58", marginTop: 6, textAlign: isUser ? "right" : "left" }}>
            {msg.timestamp}
          </div>
        )}
      </div>
    </div>
  );
}

const SUGGESTED_QUESTIONS = [
  "Which of my stocks is the riskiest?",
  "Am I too concentrated in tech?",
  "What would happen if the market drops 20%?",
  "Should I rebalance my portfolio?",
  "Compare AAPL vs TSLA performance this year",
  "What sectors am I missing?",
  "Is my portfolio appropriate for my age?",
  "What's the outlook for my biggest holding?",
];

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: "#0d1117", border: "1px solid #30363d", padding: "10px 14px", borderRadius: 8 }}>
      <div style={{ color: d.color, fontWeight: 700 }}>{d.name}</div>
      <div style={{ color: "#e6edf3", fontSize: 13 }}>${Number(d.value).toLocaleString()}</div>
      <div style={{ color: "#8b949e", fontSize: 12 }}>{d.pct}%</div>
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────
export default function PortfolioTracker() {
  const [stocks, setStocks] = useState([
    { id: 1, ticker: "AAPL", amount: 5000 },
    { id: 2, ticker: "TSLA", amount: 3000 },
  ]);
  const [newTicker, setNewTicker] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [age, setAge] = useState("35");
  const [netWorth, setNetWorth] = useState("500000");
  const [news, setNews] = useState({});
  const [advice, setAdvice] = useState("");
  const [loadingNews, setLoadingNews] = useState({});
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [activeTab, setActiveTab] = useState("portfolio");

  const [prices, setPrices] = useState({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [countdown, setCountdown] = useState(PRICE_REFRESH_INTERVAL / 1000);
  const refreshTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);

  const [ccStocks, setCcStocks] = useState([
    { id: 1, ticker: "AAPL", shares: 100, costBasis: 170, strikeTarget: 185 },
  ]);
  const [ccNewTicker, setCcNewTicker] = useState("");
  const [ccShares, setCcShares] = useState("100");
  const [ccCostBasis, setCcCostBasis] = useState("");
  const [ccStrikeTarget, setCcStrikeTarget] = useState("");
  const [ccAdvice, setCcAdvice] = useState({});
  const [ccLoading, setCcLoading] = useState({});

  const [chatHistory, setChatHistory] = useState([
    {
      id: 0, role: "assistant",
      content: "Hello! I'm your portfolio assistant. I have full context of your holdings, prices, and financial profile. Ask me anything — about specific stocks, your allocation, market conditions, options strategy, or anything else finance-related.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef(null);
  const chatInputRef = useRef(null);
  const messageIdRef = useRef(1000); 

  const total = stocks.reduce((sum, s) => sum + Number(s.amount), 0);
  const chartData = stocks.map((s, i) => ({
    name: s.ticker, value: Number(s.amount),
    pct: total > 0 ? ((Number(s.amount) / total) * 100).toFixed(1) : 0,
    color: COLORS[i % COLORS.length],
  }));

  const buildPortfolioContext = useCallback(() => {
    const holdings = stocks.map(s => {
      const pct = total > 0 ? ((s.amount / total) * 100).toFixed(1) : 0;
      const pd = prices[s.ticker];
      const priceStr = pd ? ` (current price: $${pd.price?.toFixed(2)}, today: ${pd.change >= 0 ? "+" : ""}${pd.change?.toFixed(2)}%)` : "";
      return `  - ${s.ticker}: $${s.amount.toLocaleString()} (${pct}% of portfolio)${priceStr}`;
    }).join("\n");
    const ccPositions = ccStocks.map(s =>
      `  - ${s.ticker}: ${s.shares} shares, cost basis $${s.costBasis}, target strike $${s.strikeTarget}`
    ).join("\n");
    return `USER PORTFOLIO CONTEXT:
Age: ${age || "not set"}
Net worth: $${netWorth ? Number(netWorth).toLocaleString() : "not set"}
Total portfolio value: $${total.toLocaleString()}

Holdings:
${holdings || "  (none)"}

Covered call positions:
${ccPositions || "  (none)"}

Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`;
  }, [stocks, prices, total, age, netWorth, ccStocks]);

  const refreshPrices = useCallback(async (tickerList) => {
    if (!tickerList.length) return;
    setPricesLoading(true);
    const data = await fetchPricesForTickers(tickerList);
    setPrices(prev => ({ ...prev, ...data }));
    setLastUpdated(new Date());
    setPricesLoading(false);
    setCountdown(PRICE_REFRESH_INTERVAL / 1000);
  }, []);

  const stockTickers = useMemo(() => stocks.map(s => s.ticker), [stocks]);

  useEffect(() => {
    if (!stockTickers.length) return;
    refreshPrices(stockTickers);
  }, [stockTickers, refreshPrices]);

  useEffect(() => {
    clearInterval(refreshTimerRef.current);
    clearInterval(countdownTimerRef.current);
    refreshTimerRef.current = setInterval(() => {
      const tickers = stocks.map(s => s.ticker);
      if (tickers.length) refreshPrices(tickers);
    }, PRICE_REFRESH_INTERVAL);
    countdownTimerRef.current = setInterval(() => {
      setCountdown(c => c <= 1 ? PRICE_REFRESH_INTERVAL / 1000 : c - 1);
    }, 1000);
    return () => { clearInterval(refreshTimerRef.current); clearInterval(countdownTimerRef.current); };
  }, [stocks, refreshPrices]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const addStock = () => {
    if (!newTicker.trim() || !newAmount) return;
    setStocks(p => [...p, { id: messageIdRef.current++, ticker: newTicker.toUpperCase().trim(), amount: Number(newAmount) }]);
    setNewTicker(""); setNewAmount("");
  };
  const removeStock = id => setStocks(p => p.filter(s => s.id !== id));
  const updateAmount = (id, val) => setStocks(p => p.map(s => s.id === id ? { ...s, amount: val } : s));

  const fetchNewsForTicker = async (ticker) => {
    setLoadingNews(p => ({ ...p, [ticker]: true }));
    try {
      const text = await callGeminiWithSearch(
        [{ role: "user", content: `Search for the latest 3 news headlines and a brief 2-sentence market sentiment summary for stock ticker: ${ticker}. Format as:\nHEADLINES:\n- headline1\n- headline2\n- headline3\n\nSENTIMENT: [2 sentences]` }],
        "You are a financial news assistant. Be concise and factual."
      );
      setNews(p => ({ ...p, [ticker]: text }));
    } catch { setNews(p => ({ ...p, [ticker]: "Could not fetch news." })); }
    setLoadingNews(p => ({ ...p, [ticker]: false }));
  };

  const getAdvice = async () => {
    if (!age || !netWorth || stocks.length === 0) return;
    setLoadingAdvice(true); setAdvice("");
    try {
      const portfolio = stocks.map(s => `${s.ticker}: $${s.amount} (${total > 0 ? ((s.amount / total) * 100).toFixed(1) : 0}%)`).join(", ");
      const text = await callGemini(
        [{ role: "user", content: `My portfolio: ${portfolio}. Total: $${total.toLocaleString()}. Age: ${age}. Net worth: $${netWorth}. I'm in my 30s with $250K-$1M net worth. Give me 4-6 bullet points on: (1) diversification, (2) age-appropriate risk, (3) red flags, (4) missing sectors. Be direct with percentages.` }],
        "You are an experienced financial advisor for professionals. Be honest and specific. Note this is not personalized financial advice; users should consult a licensed advisor."
      );
      setAdvice(text);
    } catch { setAdvice("Could not generate advice."); }
    setLoadingAdvice(false);
  };

  const addCcStock = () => {
    if (!ccNewTicker.trim()) return;
    setCcStocks(p => [...p, { id: messageIdRef.current++, ticker: ccNewTicker.toUpperCase().trim(), shares: Number(ccShares) || 100, costBasis: Number(ccCostBasis) || 0, strikeTarget: Number(ccStrikeTarget) || 0 }]);
    setCcNewTicker(""); setCcShares("100"); setCcCostBasis(""); setCcStrikeTarget("");
  };
  const removeCcStock = id => setCcStocks(p => p.filter(s => s.id !== id));
  const updateCcField = (id, field, val) => setCcStocks(p => p.map(s => s.id === id ? { ...s, [field]: val } : s));

  const getCcAdvice = async (stock) => {
    setCcLoading(p => ({ ...p, [stock.id]: true }));
    setCcAdvice(p => ({ ...p, [stock.id]: "" }));
    try {
      const text = await callGeminiWithSearch(
        [{ role: "user", content: `I own ${stock.shares} shares of ${stock.ticker} with a cost basis of $${stock.costBasis || "unknown"} per share. I am considering selling a covered call this week${stock.strikeTarget ? ` targeting a strike around $${stock.strikeTarget}` : ""}. Please: (1) search for the latest news and market sentiment on ${stock.ticker}, (2) check for any upcoming earnings, FDA decisions, analyst upgrades/downgrades, or major catalysts THIS week or next, (3) assess implied volatility environment — is IV elevated (good to sell) or depressed (bad to sell)? (4) give a clear SELL THE CALL or HOLD OFF verdict with reasoning. Format your response EXACTLY as:\nVERDICT: [SELL THE CALL / HOLD OFF / NEUTRAL]\n\nREASONING:\n- [point 1]\n- [point 2]\n- [point 3]\n\nKEY RISKS IF SELLING:\n- [risk 1]\n- [risk 2]\n\nSUGGESTED STRIKE ZONE: [price range and expiry, or N/A]` }],
        "You are an expert options trader specializing in covered calls for retail investors. Give weekly-actionable, direct advice. Factor in current news, upcoming catalysts, and IV. Always note this is not financial advice."
      );
      setCcAdvice(p => ({ ...p, [stock.id]: text }));
    } catch { setCcAdvice(p => ({ ...p, [stock.id]: "Could not generate covered call advice at this time." })); }
    setCcLoading(p => ({ ...p, [stock.id]: false }));
  };

  const sendChatMessage = async (messageText) => {
    const text = (messageText || chatInput).trim();
    if (!text || chatLoading) return;
    setChatInput("");

    const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsg = { id: messageIdRef.current++, role: "user", content: text, timestamp };
    const typingMsg = { id: messageIdRef.current++, role: "assistant", content: "", typing: true };

    setChatHistory(h => [...h, userMsg, typingMsg]);
    setChatLoading(true);

    const historyForApi = [...chatHistory, userMsg]
      .filter(m => !m.typing && m.id !== 0)
      .map(m => ({ role: m.role, content: m.content }));

    const systemPrompt = `You are a knowledgeable, friendly financial assistant integrated into a personal portfolio tracker. You have full context of the user's portfolio at all times.

${buildPortfolioContext()}

Guidelines:
- Be conversational but precise. Use the user's actual holdings in your answers.
- When asked about specific stocks, search the web for current data.
- Reference specific percentages and dollar amounts from their portfolio when relevant.
- Be honest about risks and downsides, not just positives.
- Keep responses concise unless the question warrants depth.
- Use **bold** for key terms or important numbers.
- Always note that you're not a licensed financial advisor when giving investment recommendations.`;

    try {
      const needsSearch = /news|price|today|current|recent|latest|now|this week|market|earnings|analyst|rating|target|outlook|forecast/i.test(text);
      let response;
      if (needsSearch) {
        response = await callGeminiWithSearch(historyForApi, systemPrompt, 1500);
      } else {
        response = await callGemini(historyForApi, systemPrompt, 1500);
      }
      const aiTimestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setChatHistory(h => h.filter(m => !m.typing).concat({
        id: messageIdRef.current++, role: "assistant", content: response, timestamp: aiTimestamp,
      }));
    } catch {
      setChatHistory(h => h.filter(m => !m.typing).concat({
        id: messageIdRef.current++, role: "assistant", content: "Sorry, I couldn't process that request. Please try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }));
    }
    setChatLoading(false);
    setTimeout(() => chatInputRef.current?.focus(), 100);
  };

  const clearChat = () => {
    setChatHistory([{
      id: 0, role: "assistant",
      content: "Chat cleared. I still have full context of your portfolio. What would you like to know?",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);
  };

  const inp = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, color: "#e6edf3", padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box", width: "100%" };
  const lbl = { fontSize: 10, letterSpacing: "1.5px", color: "#8b949e", marginBottom: 5, display: "block" };
  const fmtTime = (d) => d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  const tabs = [
    { id: "portfolio", label: "◈ Holdings" },
    { id: "news",      label: "⚡ News" },
    { id: "advice",    label: "◎ AI Advice" },
    { id: "covered",   label: "📉 Covered Calls" },
    { id: "chat",      label: "💬 Ask AI" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "'DM Mono','Courier New',monospace" }}>

      <div style={{ borderBottom: "1px solid #21262d", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(135deg,#0d1117,#161b22)" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#58a6ff" }}>◈ PORTFOLIO.AI</div>
          <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2, letterSpacing: "2px" }}>INTELLIGENT STOCK & OPTIONS TRACKER</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#8b949e", letterSpacing: "1px" }}>PORTFOLIO VALUE</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#3fb950" }}>${total.toLocaleString()}</div>
        </div>
      </div>

      <div style={{ borderBottom: "1px solid #21262d", padding: "0 32px", display: "flex", overflowX: "auto" }}>
        {tabs.map(t => {
          const activeColor = t.id === "covered" ? "#ffd93d" : t.id === "chat" ? "#c77dff" : "#58a6ff";
          return (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              background: "none", border: "none",
              color: activeTab === t.id ? activeColor : "#8b949e",
              padding: "14px 20px", cursor: "pointer", fontSize: 12, letterSpacing: "1.5px",
              textTransform: "uppercase",
              borderBottom: activeTab === t.id ? `2px solid ${activeColor}` : "2px solid transparent",
              whiteSpace: "nowrap", transition: "color 0.2s",
            }}>{t.label}</button>
          );
        })}
      </div>

      <div style={{ padding: activeTab === "chat" ? "0" : "28px 32px", maxWidth: activeTab === "chat" ? "none" : 1100, margin: "0 auto" }}>
        {activeTab === "portfolio" && (
          <div>
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: "20px 24px", marginBottom: 20, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 110 }}><label style={lbl}>TICKER</label><input value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && addStock()} placeholder="NVDA" style={inp} /></div>
              <div style={{ flex: 2, minWidth: 140 }}><label style={lbl}>AMOUNT ($)</label><input value={newAmount} onChange={e => setNewAmount(e.target.value)} onKeyDown={e => e.key === "Enter" && addStock()} placeholder="5000" type="number" style={inp} /></div>
              <button onClick={addStock} style={{ background: "#238636", color: "#fff", border: "none", borderRadius: 6, padding: "9px 20px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", letterSpacing: "1px", fontWeight: 600 }}>+ ADD</button>
            </div>

            <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 8, padding: "8px 18px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: pricesLoading ? "#ffd93d" : "#3fb950", boxShadow: `0 0 6px ${pricesLoading ? "#ffd93d" : "#3fb950"}`, animation: pricesLoading ? "pulse 0.8s infinite" : "none" }} />
                <span style={{ fontSize: 11, color: "#8b949e", letterSpacing: "1px" }}>{pricesLoading ? "FETCHING LIVE PRICES..." : "PRICES LIVE"}</span>
                {lastUpdated && !pricesLoading && <span style={{ fontSize: 10, color: "#484f58" }}>· updated {fmtTime(lastUpdated)}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {!pricesLoading && <span style={{ fontSize: 10, color: "#484f58" }}>refresh in <span style={{ color: countdown <= 10 ? "#ffd93d" : "#8b949e" }}>{countdown}s</span></span>}
                <button onClick={() => refreshPrices(stocks.map(s => s.ticker))} disabled={pricesLoading} style={{ background: "none", border: "1px solid #30363d", color: pricesLoading ? "#484f58" : "#58a6ff", borderRadius: 5, padding: "3px 10px", cursor: pricesLoading ? "default" : "pointer", fontSize: 11, fontFamily: "inherit" }}>
                  ⟳ refresh now
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: 24 }}>
                <div style={{ fontSize: 11, letterSpacing: "2px", color: "#8b949e", marginBottom: 16 }}>ALLOCATION</div>
                {stocks.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={chartData} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3} dataKey="value">
                        {chartData.map((e, i) => <Cell key={i} fill={e.color} strokeWidth={0} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "#484f58" }}>Add stocks above</div>}
              </div>
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: 24 }}>
                <div style={{ fontSize: 11, letterSpacing: "2px", color: "#8b949e", marginBottom: 16 }}>BREAKDOWN</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {chartData.map((d, i) => (
                    <div key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                        <span style={{ color: d.color, fontWeight: 700 }}>{d.name}</span>
                        <span style={{ color: "#8b949e" }}>${Number(d.value).toLocaleString()} · {d.pct}%</span>
                      </div>
                      <div style={{ background: "#21262d", borderRadius: 3, height: 6 }}>
                        <div style={{ background: d.color, height: 6, borderRadius: 3, width: `${d.pct}%`, transition: "width 0.5s" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "11px 24px", borderBottom: "1px solid #21262d", display: "grid", gridTemplateColumns: "90px 180px 1fr 140px 100px 70px", gap: 12, fontSize: 10, letterSpacing: "2px", color: "#8b949e" }}>
                <span>TICKER</span><span>LIVE PRICE</span><span>ALLOCATION BAR</span><span>AMOUNT ($)</span><span>% OF PORT.</span><span></span>
              </div>
              {stocks.length === 0 && <div style={{ padding: 32, textAlign: "center", color: "#484f58", fontSize: 13 }}>No holdings yet.</div>}
              {stocks.map((s, i) => {
                const pct = total > 0 ? ((s.amount / total) * 100).toFixed(1) : 0;
                const color = COLORS[i % COLORS.length];
                return (
                  <div key={s.id} style={{ padding: "13px 24px", borderBottom: "1px solid #21262d", display: "grid", gridTemplateColumns: "90px 180px 1fr 140px 100px 70px", gap: 12, alignItems: "center" }}>
                    <span style={{ color, fontWeight: 700, fontSize: 14 }}>{s.ticker}</span>
                    <LivePrice priceData={prices[s.ticker]} loading={pricesLoading && !prices[s.ticker]} />
                    <div style={{ background: "#21262d", borderRadius: 3, height: 7 }}>
                      <div style={{ background: color, height: 7, borderRadius: 3, width: `${pct}%`, transition: "width 0.4s" }} />
                    </div>
                    <input type="number" value={s.amount} onChange={e => updateAmount(s.id, Number(e.target.value))} style={{ ...inp, padding: "5px 10px", fontSize: 12 }} />
                    <span style={{ color: "#3fb950", fontSize: 13 }}>{pct}%</span>
                    <button onClick={() => removeStock(s.id)} style={{ background: "none", border: "1px solid #f8514920", color: "#f85149", borderRadius: 5, padding: "4px 8px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>✕</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "news" && (
          <div>
            <div style={{ color: "#8b949e", fontSize: 12, marginBottom: 20, letterSpacing: "1px" }}>Real-time headlines via web search.</div>
            {stocks.length === 0 && <div style={{ color: "#8b949e", fontSize: 13, padding: 32, textAlign: "center", background: "#161b22", borderRadius: 10, border: "1px solid #30363d" }}>Add stocks in the Portfolio tab first.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {stocks.map((s, i) => (
                <div key={s.id} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "14px 24px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <span style={{ color: COLORS[i % COLORS.length], fontWeight: 700, fontSize: 16 }}>{s.ticker}</span>
                      <LivePrice priceData={prices[s.ticker]} loading={pricesLoading && !prices[s.ticker]} />
                    </div>
                    <button onClick={() => fetchNewsForTicker(s.ticker)} disabled={loadingNews[s.ticker]} style={{ background: loadingNews[s.ticker] ? "#21262d" : "#1f6feb", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: loadingNews[s.ticker] ? "default" : "pointer", fontSize: 11, fontFamily: "inherit", letterSpacing: "1px" }}>
                      {loadingNews[s.ticker] ? "⟳ FETCHING..." : "⚡ GET NEWS"}
                    </button>
                  </div>
                  {news[s.ticker] ? <div style={{ padding: "14px 24px" }}><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12, color: "#c9d1d9", lineHeight: 1.7, margin: 0 }}>{news[s.ticker]}</pre></div>
                    : <div style={{ padding: "12px 24px", color: "#484f58", fontSize: 12 }}>Press GET NEWS to fetch latest headlines</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "advice" && (
          <div>
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: 24, marginBottom: 24 }}>
              <div style={{ fontSize: 11, letterSpacing: "2px", color: "#8b949e", marginBottom: 16 }}>YOUR PROFILE</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 120 }}><label style={lbl}>AGE</label><input value={age} onChange={e => setAge(e.target.value)} placeholder="35" type="number" style={inp} /></div>
                <div style={{ flex: 2, minWidth: 170 }}><label style={lbl}>NET WORTH ($)</label><input value={netWorth} onChange={e => setNetWorth(e.target.value)} placeholder="500000" type="number" style={inp} /></div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button onClick={getAdvice} disabled={loadingAdvice || !age || !netWorth || stocks.length === 0} style={{ background: loadingAdvice ? "#21262d" : "#8957e5", color: "#fff", border: "none", borderRadius: 6, padding: "9px 22px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", letterSpacing: "1px", fontWeight: 600 }}>
                    {loadingAdvice ? "⟳ ANALYZING..." : "◎ GET AI ADVICE"}
                  </button>
                </div>
              </div>
            </div>
            {advice && (
              <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: 24 }}>
                <div style={{ fontSize: 11, letterSpacing: "2px", color: "#8957e5", marginBottom: 14 }}>◎ AI ANALYSIS</div>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, color: "#c9d1d9", lineHeight: 1.8, margin: 0 }}>{advice}</pre>
                <div style={{ marginTop: 16, padding: "9px 14px", background: "#21262d", borderRadius: 6, fontSize: 11, color: "#8b949e", borderLeft: "3px solid #8957e5" }}>
                  ⚠ Educational purposes only. Consult a licensed financial advisor before investing.
                </div>
              </div>
            )}
            {!advice && !loadingAdvice && <div style={{ textAlign: "center", padding: 48, color: "#484f58", fontSize: 13 }}>Enter your profile above and click GET AI ADVICE</div>}
          </div>
        )}

        {activeTab === "covered" && (
          <div>
            <div style={{ background: "#161b22", border: "1px solid #ffd93d30", borderRadius: 10, padding: "14px 22px", marginBottom: 24, display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ fontSize: 20, marginTop: 1 }}>📉</span>
              <div>
                <div style={{ fontSize: 12, color: "#ffd93d", fontWeight: 700, marginBottom: 4, letterSpacing: "1px" }}>COVERED CALL WEEKLY ADVISOR</div>
                <div style={{ fontSize: 12, color: "#8b949e", lineHeight: 1.6 }}>Add stocks you hold 100+ shares of. Click <strong style={{ color: "#c9d1d9" }}>ANALYZE THIS WEEK</strong> for a live news-driven recommendation factoring in earnings, catalysts, IV, and sentiment.</div>
              </div>
            </div>
            <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: "20px 24px", marginBottom: 28 }}>
              <div style={{ fontSize: 11, letterSpacing: "2px", color: "#8b949e", marginBottom: 16 }}>ADD COVERED CALL POSITION</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ minWidth: 95 }}><label style={lbl}>TICKER</label><input value={ccNewTicker} onChange={e => setCcNewTicker(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && addCcStock()} placeholder="AAPL" style={inp} /></div>
                <div style={{ minWidth: 90 }}><label style={lbl}>SHARES</label><input value={ccShares} onChange={e => setCcShares(e.target.value)} placeholder="100" type="number" style={inp} /></div>
                <div style={{ minWidth: 115 }}><label style={lbl}>COST BASIS ($)</label><input value={ccCostBasis} onChange={e => setCcCostBasis(e.target.value)} placeholder="170.00" type="number" style={inp} /></div>
                <div style={{ minWidth: 130 }}><label style={lbl}>TARGET STRIKE ($) <span style={{ color: "#484f58" }}>optional</span></label><input value={ccStrikeTarget} onChange={e => setCcStrikeTarget(e.target.value)} placeholder="185.00" type="number" style={inp} /></div>
                <button onClick={addCcStock} style={{ background: "#1a3a1e", color: "#3fb950", border: "1px solid #238636", borderRadius: 6, padding: "9px 18px", cursor: "pointer", fontSize: 12, fontFamily: "inherit", letterSpacing: "1px", fontWeight: 600, whiteSpace: "nowrap" }}>+ ADD POSITION</button>
              </div>
            </div>
            {ccStocks.length === 0 && <div style={{ textAlign: "center", padding: 56, color: "#484f58", fontSize: 13, background: "#161b22", borderRadius: 10, border: "1px solid #30363d" }}>No covered call positions yet.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {ccStocks.map((s, i) => {
                const color = COLORS[i % COLORS.length];
                const hasAdvice = !!ccAdvice[s.id];
                const isLoading = !!ccLoading[s.id];
                const upside = s.costBasis > 0 && s.strikeTarget > 0 ? ((s.strikeTarget - s.costBasis) / s.costBasis * 100).toFixed(1) : null;
                return (
                  <div key={s.id} style={{ background: "#161b22", border: `1px solid ${color}30`, borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "16px 24px", background: "#0d1117", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                        <span style={{ color, fontWeight: 700, fontSize: 20 }}>{s.ticker}</span>
                        <LivePrice priceData={prices[s.ticker]} loading={pricesLoading && !prices[s.ticker]} />
                        <div style={{ display: "flex", gap: 14, fontSize: 12 }}>
                          <span><span style={{ color: "#484f58" }}>shares: </span><span style={{ color: "#e6edf3" }}>{s.shares}</span></span>
                          {s.costBasis > 0 && <span><span style={{ color: "#484f58" }}>basis: </span><span style={{ color: "#e6edf3" }}>${s.costBasis}</span></span>}
                          {s.strikeTarget > 0 && <span><span style={{ color: "#484f58" }}>target: </span><span style={{ color: "#ffd93d" }}>${s.strikeTarget}</span></span>}
                          {upside !== null && <span><span style={{ color: "#484f58" }}>upside: </span><span style={{ color: Number(upside) >= 0 ? "#3fb950" : "#f85149", fontWeight: 700 }}>{upside}%</span></span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => getCcAdvice(s)} disabled={isLoading} style={{ background: isLoading ? "#21262d" : `${color}20`, color: isLoading ? "#484f58" : color, border: `1px solid ${isLoading ? "#30363d" : color + "80"}`, borderRadius: 6, padding: "7px 16px", cursor: isLoading ? "default" : "pointer", fontSize: 11, fontFamily: "inherit", letterSpacing: "1px", fontWeight: 700 }}>
                          {isLoading ? "⟳ ANALYZING..." : "⚡ ANALYZE THIS WEEK"}
                        </button>
                        <button onClick={() => removeCcStock(s.id)} style={{ background: "none", border: "1px solid #f8514920", color: "#f85149", borderRadius: 5, padding: "6px 10px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>✕</button>
                      </div>
                    </div>
                    <div style={{ padding: "12px 24px", borderBottom: "1px solid #21262d", display: "flex", gap: 12, flexWrap: "wrap", background: "#0d111780", alignItems: "flex-end" }}>
                      <div style={{ minWidth: 90 }}><label style={{ ...lbl, marginBottom: 3 }}>SHARES</label><input type="number" value={s.shares} onChange={e => updateCcField(s.id, "shares", Number(e.target.value))} style={{ ...inp, padding: "5px 10px", fontSize: 12 }} /></div>
                      <div style={{ minWidth: 110 }}><label style={{ ...lbl, marginBottom: 3 }}>COST BASIS ($)</label><input type="number" value={s.costBasis} onChange={e => updateCcField(s.id, "costBasis", Number(e.target.value))} style={{ ...inp, padding: "5px 10px", fontSize: 12 }} /></div>
                      <div style={{ minWidth: 120 }}><label style={{ ...lbl, marginBottom: 3 }}>TARGET STRIKE ($)</label><input type="number" value={s.strikeTarget} onChange={e => updateCcField(s.id, "strikeTarget", Number(e.target.value))} style={{ ...inp, padding: "5px 10px", fontSize: 12 }} /></div>
                      {s.shares >= 100 && <div style={{ fontSize: 11, color: "#3fb950", paddingBottom: 7 }}>✓ {Math.floor(s.shares / 100)} contract{Math.floor(s.shares / 100) > 1 ? "s" : ""} available</div>}
                    </div>
                    {isLoading && <div style={{ padding: 28, textAlign: "center" }}><div style={{ fontSize: 26, marginBottom: 8 }}>⟳</div><div style={{ color: "#8b949e", fontSize: 12 }}>Analyzing news, catalysts & IV for <span style={{ color }}>{s.ticker}</span>...</div></div>}
                    {hasAdvice && !isLoading && (
                      <div style={{ padding: "20px 24px" }}>
                        <Verdict text={ccAdvice[s.id]} />
                        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12, color: "#c9d1d9", lineHeight: 1.85, margin: 0 }}>{ccAdvice[s.id]}</pre>
                        <div style={{ marginTop: 16, padding: "9px 14px", background: "#21262d", borderRadius: 6, fontSize: 11, color: "#8b949e", borderLeft: `3px solid ${color}` }}>⚠ AI-generated analysis only. Not financial advice. Options trading involves risk of loss. Consult a licensed financial advisor.</div>
                      </div>
                    )}
                    {!hasAdvice && !isLoading && <div style={{ padding: "16px 24px", color: "#484f58", fontSize: 12 }}>Click <strong style={{ color: "#8b949e" }}>ANALYZE THIS WEEK</strong> for a live covered call recommendation.</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "chat" && (
          <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 130px)" }}>
            <div style={{ padding: "16px 32px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d1117" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#1a1a2e", border: "1px solid #c77dff50", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>💬</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#c77dff" }}>PORTFOLIO ASSISTANT</div>
                  <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: "1px" }}>
                    AWARE OF: {stocks.length} HOLDINGS · {ccStocks.length} CC POSITIONS · LIVE PRICES
                  </div>
                </div>
              </div>
              <button onClick={clearChat} style={{ background: "none", border: "1px solid #30363d", color: "#8b949e", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
                ↺ clear chat
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px", display: "flex", flexDirection: "column" }}>
              {chatHistory.map(msg => <ChatMessage key={msg.id} msg={msg} />)}
              <div ref={chatBottomRef} />
            </div>

            {chatHistory.length <= 2 && (
              <div style={{ padding: "0 32px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <button key={i} onClick={() => sendChatMessage(q)} style={{
                    background: "#161b22", border: "1px solid #30363d", color: "#8b949e",
                    borderRadius: 20, padding: "6px 14px", cursor: "pointer", fontSize: 11,
                    fontFamily: "inherit", transition: "all 0.15s",
                  }}
                    onMouseEnter={e => { e.target.style.borderColor = "#c77dff50"; e.target.style.color = "#c9d1d9"; }}
                    onMouseLeave={e => { e.target.style.borderColor = "#30363d"; e.target.style.color = "#8b949e"; }}
                  >{q}</button>
                ))}
              </div>
            )}

            <div style={{ padding: "16px 32px", borderTop: "1px solid #21262d", background: "#0d1117", display: "flex", gap: 12, alignItems: "flex-end" }}>
              <div style={{ flex: 1, position: "relative" }}>
                <textarea
                  ref={chatInputRef}
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendChatMessage();
                    }
                  }}
                  placeholder="Ask anything about your portfolio or any stock... (Enter to send, Shift+Enter for new line)"
                  rows={2}
                  style={{
                    ...inp, padding: "12px 16px", fontSize: 13, resize: "none",
                    lineHeight: 1.5, borderColor: chatInput ? "#c77dff50" : "#30363d",
                    transition: "border-color 0.2s",
                  }}
                />
              </div>
              <button
                onClick={() => sendChatMessage()}
                disabled={!chatInput.trim() || chatLoading}
                style={{
                  background: (!chatInput.trim() || chatLoading) ? "#21262d" : "#c77dff",
                  color: (!chatInput.trim() || chatLoading) ? "#484f58" : "#0d1117",
                  border: "none", borderRadius: 8, padding: "12px 20px",
                  cursor: (!chatInput.trim() || chatLoading) ? "default" : "pointer",
                  fontSize: 14, fontFamily: "inherit", fontWeight: 700,
                  transition: "all 0.2s", whiteSpace: "nowrap",
                }}
              >
                {chatLoading ? "⟳" : "↑ SEND"}
              </button>
            </div>

            <div style={{ padding: "8px 32px 12px", fontSize: 10, color: "#484f58", textAlign: "center" }}>
              ⚠ AI responses are for educational purposes only and do not constitute financial advice. Consult a licensed advisor.
            </div>
          </div>
        )}

      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
      `}</style>
    </div>
  );
}