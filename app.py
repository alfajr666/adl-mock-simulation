import http.server
import socketserver
import json
import urllib.request
import threading
import time
import os
import math

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# Global Thread-safe State
state_lock = threading.RLock()
sim_state = {
    "simStep": 0,  # 0: INIT, 1: LIQUIDATED, 2: FUND DEPLETED, 3: ADL FIRED, 99: ATTACK SCENARIO
    "insuranceFund": 2400000,
    "activeMethod": "QFEX",  # "Legacy" or "QFEX"
    "prices": {"BTCUSDT": 65000.0, "ETHUSDT": 3400.0, "SOLUSDT": 145.0},
    "priceChanges": {"BTCUSDT": 0.0, "ETHUSDT": 0.0, "SOLUSDT": 0.0},
    "fundingRate": 0.0100,
    "isDemoMode": False,
    "positions": [],
    "logs": [],
    "bankruptPrice": None,
    "lossGap": 0.0,
    "gapRemaining": 0.0
}

BASE_TRADERS = [
    # Main Exchange Traders
    {"id": 'T1', "name": 'whale_btc',     "side": 'LONG',  "sizeUSD": 500000, "lev": 20, "entryOffset": -0.045, "symbol": "BTCUSDT", "isRetail": False},
    {"id": 'T2', "name": 'algo_long',     "side": 'LONG',  "sizeUSD": 120000, "lev": 10, "entryOffset": -0.028, "symbol": "BTCUSDT", "isRetail": False},
    {"id": 'T3', "name": 'degen99',       "side": 'LONG',  "sizeUSD": 80000,  "lev": 25, "entryOffset": -0.072, "symbol": "BTCUSDT", "isRetail": False},
    {"id": 'T7', "name": 'perp_newbie',   "side": 'LONG',  "sizeUSD": 8000,   "lev": 5,  "entryOffset": -0.031, "symbol": "BTCUSDT", "isRetail": False},
    {"id": 'T4', "name": 'hedger_pro',    "side": 'SHORT', "sizeUSD": 300000, "lev": 5,  "entryOffset": +0.038, "symbol": "BTCUSDT", "isRetail": False},
    {"id": 'T5', "name": 'short_squeeze', "side": 'SHORT', "sizeUSD": 200000, "lev": 15, "entryOffset": +0.055, "symbol": "BTCUSDT", "isRetail": False},
    {"id": 'T6', "name": 'scalper_x',     "side": 'SHORT', "sizeUSD": 60000,  "lev": 30, "entryOffset": +0.021, "symbol": "BTCUSDT", "isRetail": False},
    {"id": 'T8', "name": 'attacker_long', "side": 'LONG',  "sizeUSD": 50000,  "lev": 20, "entryOffset": -0.033, "symbol": "BTCUSDT", "hidden": True, "isRetail": False},
    
    # Retail Archetypes (User POV)
    {"id": 'R1', "name": 'Conservative',  "side": 'LONG',  "sizeUSD": 2000,   "lev": 2,  "entryOffset": -0.035, "symbol": "BTCUSDT", "isRetail": True},
    {"id": 'R2', "name": 'Leveraged',     "side": 'LONG',  "sizeUSD": 5000,   "lev": 10, "entryOffset": -0.025, "symbol": "BTCUSDT", "isRetail": True},
    {"id": 'R3', "name": 'Aggressive',    "side": 'LONG',  "sizeUSD": 10000,  "lev": 50, "entryOffset": -0.015, "symbol": "BTCUSDT", "isRetail": True},
]

def fmt(num):
    return f"{num:,.2f}"

def log_event(msg, log_type="muted"):
    timestamp = time.strftime("%H:%M:%S", time.localtime())
    with state_lock:
        sim_state["logs"].append({"time": timestamp, "message": msg, "type": log_type})
        if len(sim_state["logs"]) > 200:
            sim_state["logs"].pop(0)

def calculate_position(pos, current_price):
    if pos["status"] != "OPEN":
        return

    qty = pos["sizeUSD"] / pos["entryPrice"]
    pos["qty"] = qty
    
    if pos["side"] == "LONG":
        pnl = (current_price - pos["entryPrice"]) * qty
    else:
        pnl = (pos["entryPrice"] - current_price) * qty
    
    pos["pnl"] = pnl
    margin = pos["sizeUSD"] / pos["lev"]
    pos["margin"] = margin
    pos["pnlPct"] = pnl / margin

    denom = pos["sizeUSD"] - abs(pnl)
    if denom <= 0:
        eff_lev = 999.0
    else:
        eff_lev = pos["sizeUSD"] / denom
    
    pos["effectiveLev"] = eff_lev

    if pnl > 0:
        pos["adlScore_legacy"] = pos["pnlPct"] * eff_lev
        pos["adlScore_qfex"] = eff_lev
    else:
        pos["adlScore_legacy"] = 0.0
        pos["adlScore_qfex"] = 0.0

def recalculate_positions():
    with state_lock:
        for pos in sim_state["positions"]:
            calculate_position(pos, sim_state["prices"][pos["symbol"]])

def init_positions(attack_mode=False):
    with state_lock:
        sim_state["positions"] = []
        for trader in BASE_TRADERS:
            if trader.get("hidden") and not attack_mode:
                continue

            live_price = sim_state["prices"][trader["symbol"]]
            entry_price = live_price * (1 + trader["entryOffset"])

            pos = {
                **trader,
                "entryPrice": entry_price,
                "status": "OPEN",
                "closePrice": None,
                "socializedDeduction": 0.0,
            }
            sim_state["positions"].append(pos)

        if attack_mode:
            # Add shadow short
            live_price = sim_state["prices"]["BTCUSDT"]
            sim_state["positions"].append({
                "id": "T8s", "name": "attacker_short", "side": "SHORT", "sizeUSD": 50000, 
                "lev": 20, "entryOffset": +0.033, "symbol": "BTCUSDT",
                "entryPrice": live_price * (1 + 0.033),
                "status": "OPEN", "closePrice": None, "socializedDeduction": 0.0, "isRetail": False
            })
            
    recalculate_positions()

def fetch_binance_data():
    while True:
        try:
            req_prices = urllib.request.Request(
                'https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","SOLUSDT"]',
                headers={'User-Agent': 'Mozilla/5.0'}
            )
            with urllib.request.urlopen(req_prices, timeout=5) as response:
                price_data = json.loads(response.read().decode())
                with state_lock:
                    for item in price_data:
                        symbol = item["symbol"]
                        sim_state["prices"][symbol] = float(item["lastPrice"])
                        sim_state["priceChanges"][symbol] = float(item["priceChangePercent"])

            req_funding = urllib.request.Request(
                'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT',
                headers={'User-Agent': 'Mozilla/5.0'}
            )
            with urllib.request.urlopen(req_funding, timeout=5) as response:
                funding_data = json.loads(response.read().decode())
                with state_lock:
                    sim_state["fundingRate"] = float(funding_data["lastFundingRate"]) * 100.0

            with state_lock:
                if sim_state["isDemoMode"]:
                    sim_state["isDemoMode"] = False
                    log_event("Binance API reconnected.", "muted")
        except Exception as e:
            with state_lock:
                if not sim_state["isDemoMode"]:
                    sim_state["isDemoMode"] = True
                    log_event(f"[API] Binance unreachable. Running in demo mode.", "warn")
                
                # Demo offline fluctuations
                for symbol in sim_state["prices"]:
                    sim_state["prices"][symbol] *= (1 + 0.0005)
        
        recalculate_positions()
        time.sleep(15)

def perform_drain():
    global sim_state
    log_event("Black swan cascade. Insurance fund draining...", "liq")
    while True:
        time.sleep(0.12)
        with state_lock:
            if sim_state["insuranceFund"] > 0:
                sim_state["insuranceFund"] = max(0, sim_state["insuranceFund"] - 180000)
            else:
                sim_state["simStep"] = 2
                loss_gap = sim_state["lossGap"]
                active_method = sim_state["activeMethod"]
                log_event(f"⚠️ INSURANCE FUND DEPLETED. Total unmatched liability: ${fmt(loss_gap)}. ADL ARMED. Method: {active_method}.", "warn")
                break

def perform_adl():
    with state_lock:
        bankrupt_price = sim_state["bankruptPrice"]
        current_mark = sim_state["prices"]["BTCUSDT"]
        loss_gap = sim_state["lossGap"]
        active_method = sim_state["activeMethod"]
        
        # Determine the opposite side queue (loser was SHORT, so we get LONGs)
        alps = [p for p in sim_state["positions"] if p["status"] == "OPEN" and p["side"] == "LONG" and p["pnl"] > 0]
        
        if active_method == "Legacy":
            alps.sort(key=lambda x: x["adlScore_legacy"], reverse=True)
        else:
            alps.sort(key=lambda x: x["adlScore_qfex"], reverse=True)
            
    log_event(f"ADL firing. Method: {active_method}. Queue: {len(alps)} eligible ALPs.", "adl")
    
    covered = 0.0
    step = 0
    
    for alp in alps:
        if covered >= loss_gap:
            break
            
        time.sleep(0.9)
        with state_lock:
            # Force close at currentMarkPrice
            pos = next((p for p in sim_state["positions"] if p["id"] == alp["id"]), None)
            if not pos or pos["status"] != "OPEN":
                continue
                
            pos["status"] = "FORCE_CLOSED"
            pos["closePrice"] = current_mark
            absorbed = max(0, pos["pnl"])
            covered += absorbed
            step += 1
            remaining = max(0, loss_gap - covered)
            sim_state["gapRemaining"] = remaining
            
            log_event(
                f"ADL step {step}: {pos['name']} force-closed. "
                f"ALP close price: ${fmt(current_mark)}. "
                f"Loser close price: ${fmt(bankrupt_price)}. "
                f"Absorbed: ${fmt(absorbed)}. "
                f"Gap remaining: ${fmt(remaining)}.",
                "adl"
            )

    time.sleep(0.9)
    with state_lock:
        if covered >= loss_gap:
            log_event(f"Loss gap fully covered after {step} ALP(s). ADL sequence complete.", "ok")
        else:
            residual = loss_gap - covered
            open_positions = [p for p in sim_state["positions"] if p["status"] == "OPEN"]
            total_equity = sum(p["margin"] + p["pnl"] for p in open_positions)
            
            for p in open_positions:
                share = (p["margin"] + p["pnl"]) / total_equity
                deduction = residual * share
                p["socializedDeduction"] = deduction
                p["status"] = "SOCIALIZED"
                
            log_event(f"⚠️ ALP queue exhausted after {step} position(s). Residual gap: ${fmt(residual)}. Socialized loss applied pro-rata across {len(open_positions)} remaining open positions.", "warn")
            
        sim_state["simStep"] = 3


def run_attack_scenario():
    with state_lock:
        sim_state["simStep"] = 99  # Attack mode track
        # Reset positions to include T8 and T8s
    
    init_positions(attack_mode=True)
    
    log_event("Step 1: Attacker holds LONG 20x ($50K) and SHORT 20x ($50K). Delta-neutral.", "muted")
    time.sleep(2)
    
    # Simulate an 8% drop (which pushes long to liquidation and short to profit)
    with state_lock:
        sim_state["prices"]["BTCUSDT"] *= 0.92
    recalculate_positions()
    
    log_event("Step 2: Price drops 8%. SHORT position profits. LONG position approaches liquidation.", "muted")
    time.sleep(2)
    
    with state_lock:
        attacker_long = next((p for p in sim_state["positions"] if p["id"] == "T8"), None)
        if attacker_long:
            attacker_long["status"] = "LIQUIDATED"
            attacker_long["closePrice"] = attacker_long["entryPrice"] * 0.95
    log_event("Step 3: attacker_long LIQUIDATED. Insurance fund absorbs loss.", "liq")
    time.sleep(2)
    
    # Show outcome for legacy vs qfex based on activeMethod
    with state_lock:
        method = sim_state["activeMethod"]
        attacker_short = next((p for p in sim_state["positions"] if p["id"] == "T8s"), None)
        gain = attacker_short["pnl"] if attacker_short else 0
        
    if method == "Legacy":
        log_event(f"Step 4 (Legacy): Under PnL% × EffLev, attacker_short ranks high in SHORT queue. ADL fires. attacker_short force-closed at currentMarkPrice. Realized gain: ${fmt(gain)}. Net extracted from mechanism: ${fmt(gain)}.", "adl")
    else:
        log_event(f"Step 4 (QFEX): Under EffLev only, attacker_short ranks by leverage only. ADL fires. attacker_short force-closed at currentMarkPrice. Realized gain: ${fmt(gain)}. Result is structurally identical — the attack still generates profit. But QFEX design closes this via asymmetric settlement: the attacker can only realize currentMarkPrice, not an inflated price.", "adl")
        
    time.sleep(2)
    log_event("Attack Scenario Complete. Review outcomes or Reset.", "ok")


class ADLSimulationHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass # Silence console logs

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            with open(os.path.join(DIRECTORY, 'index.html'), 'rb') as file:
                self.wfile.write(file.read())
        elif self.path == '/api/status':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            with state_lock:
                # Add pip counts for both queues before sending
                longs = [p for p in sim_state["positions"] if p["side"] == "LONG" and p["pnl"] > 0 and p["status"] == "OPEN"]
                shorts = [p for p in sim_state["positions"] if p["side"] == "SHORT" and p["pnl"] > 0 and p["status"] == "OPEN"]
                
                for queue in [longs, shorts]:
                    max_legacy = max([p["adlScore_legacy"] for p in queue] + [0.0001])
                    max_qfex = max([p["adlScore_qfex"] for p in queue] + [0.0001])
                    for p in queue:
                        if p["adlScore_legacy"] > 0:
                            p["pips_legacy"] = math.ceil((p["adlScore_legacy"] / max_legacy) * 5)
                        else:
                            p["pips_legacy"] = 0
                        if p["adlScore_qfex"] > 0:
                            p["pips_qfex"] = math.ceil((p["adlScore_qfex"] / max_qfex) * 5)
                        else:
                            p["pips_qfex"] = 0
                            
                response_data = json.dumps(sim_state)
            self.wfile.write(response_data.encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode() if content_length > 0 else "{}"
        try:
            payload = json.loads(post_data)
        except:
            payload = {}

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        response = {"success": True}

        if self.path == '/api/trigger-liq':
            with state_lock:
                sim_state["simStep"] = 1
                scalper = next((p for p in sim_state["positions"] if p["id"] == "T6"), None)
                if scalper:
                    scalper["status"] = "LIQUIDATED"
                    # bankruptPrice = entryPrice - (margin / qty) for SHORT
                    bankrupt_price = scalper["entryPrice"] - (scalper["margin"] / scalper["qty"])
                    sim_state["bankruptPrice"] = bankrupt_price
                    
                    current_price = sim_state["prices"]["BTCUSDT"]
                    # loss gap = |bankruptPrice - currentPrice| * qty
                    loss_gap = abs(bankrupt_price - current_price) * scalper["qty"]
                    sim_state["lossGap"] = loss_gap
                    sim_state["gapRemaining"] = loss_gap
                    
                    absorb = loss_gap * 0.6
                    sim_state["insuranceFund"] = max(0, sim_state["insuranceFund"] - absorb)
                    
                    log_event(f"scalper_x (SHORT 30x) LIQUIDATED at ${fmt(current_price)}. Loss gap: ${fmt(loss_gap)}. Fund absorbing ${fmt(absorb)}.", "liq")
                    log_event(f"Insurance fund: ${fmt(sim_state['insuranceFund'])} (was $2,400,000).", "ins")
            recalculate_positions()

        elif self.path == '/api/drain':
            threading.Thread(target=perform_drain, daemon=True).start()

        elif self.path == '/api/fire-adl':
            threading.Thread(target=perform_adl, daemon=True).start()

        elif self.path == '/api/attack-scenario':
            threading.Thread(target=run_attack_scenario, daemon=True).start()

        elif self.path == '/api/toggle-method':
            with state_lock:
                sim_state["activeMethod"] = payload.get("method", "Legacy")
                log_event(f"Ranking method toggled to {sim_state['activeMethod']}", "muted")

        elif self.path == '/api/reset':
            with state_lock:
                sim_state["simStep"] = 0
                sim_state["insuranceFund"] = 2400000
                sim_state["logs"] = []
                sim_state["bankruptPrice"] = None
                sim_state["lossGap"] = 0.0
                sim_state["gapRemaining"] = 0.0
            init_positions()
            log_event("System initialized. Insurance fund: $2,400,000. Positions open. Prices live.", "ok")

        elif self.path == '/api/calculate-personal':
            try:
                symbol = payload.get("symbol", "BTCUSDT")
                entry = float(payload["entry"])
                size = float(payload["size"])
                leverage = float(payload["leverage"])
                side = payload["side"]

                with state_lock:
                    current_price = sim_state["prices"].get(symbol, 65000.0)
                    
                pos = {
                    "status": "OPEN", "sizeUSD": size, "entryPrice": entry,
                    "side": side, "lev": leverage, "symbol": symbol
                }
                calculate_position(pos, current_price)
                
                # Fetch current queues to rank
                with state_lock:
                    queue = [p for p in sim_state["positions"] if p["side"] == side and p["pnl"] > 0 and p["status"] == "OPEN"]
                    max_legacy = max([p["adlScore_legacy"] for p in queue] + [pos.get("adlScore_legacy", 0)])
                    max_qfex = max([p["adlScore_qfex"] for p in queue] + [pos.get("adlScore_qfex", 0)])
                
                pips_legacy = math.ceil((pos["adlScore_legacy"] / max_legacy) * 5) if pos["adlScore_legacy"] > 0 else 0
                pips_qfex = math.ceil((pos["adlScore_qfex"] / max_qfex) * 5) if pos["adlScore_qfex"] > 0 else 0
                
                response.update({
                    "pnl": pos["pnl"],
                    "pnlPct": pos["pnlPct"] * 100,
                    "effectiveLev": pos["effectiveLev"],
                    "adlScore_legacy": pos["adlScore_legacy"],
                    "adlScore_qfex": pos["adlScore_qfex"],
                    "pips_legacy": pips_legacy,
                    "pips_qfex": pips_qfex,
                    "inProfit": pos["pnl"] > 0
                })
            except Exception as e:
                response = {"success": False, "error": str(e)}

        self.wfile.write(json.dumps(response).encode())

# Initialize data and run server
init_positions()
log_event("System initialized. Insurance fund: $2,400,000. Positions open. Prices live.", "ok")
threading.Thread(target=fetch_binance_data, daemon=True).start()

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    pass

def start_server():
    server = ThreadingHTTPServer(('0.0.0.0', PORT), ADLSimulationHandler)
    print(f"Server running at http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server.server_close()

if __name__ == '__main__':
    start_server()
