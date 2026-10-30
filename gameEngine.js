'use strict';

// ─── CONSTANTES ───────────────────────────────────────────────
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL = Object.fromEntries(RANKS.map((r,i) => [r, i+2]));
const RED_SUITS = new Set(['♥','♦']);

const HAND_NAMES = [
  'Carta Alta','Par','Dos Pares','Trío',
  'Escalera','Color','Full House','Póker','Escalera de Color'
];

// ─── MAZO ─────────────────────────────────────────────────────
function makeDeck() {
  const deck = [];
  for (const s of SUITS)
    for (const r of RANKS)
      deck.push({ r, s });
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── EVALUADOR DE MANOS ───────────────────────────────────────
function getCombos(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === k) return [arr.slice()];
  const [first, ...rest] = arr;
  return [
    ...getCombos(rest, k-1).map(c => [first, ...c]),
    ...getCombos(rest, k)
  ];
}

function score5(cards) {
  const vals = cards.map(c => RANK_VAL[c.r]).sort((a,b) => b-a);
  const suits = cards.map(c => c.s);
  const flush = suits.every(s => s === suits[0]);
  const straight = vals[0]-vals[4] === 4 && new Set(vals).size === 5;
  const aceLow = vals[0]===14 && JSON.stringify(vals.slice(1))==='[5,4,3,2]';
  const counts = {};
  vals.forEach(v => counts[v] = (counts[v]||0)+1);
  const cv = Object.values(counts).sort((a,b) => b-a);
  const tb = vals.reduce((a,v,i) => a + v*Math.pow(100,4-i), 0);

  let rank = 0;
  if (flush && (straight||aceLow)) rank = 8;
  else if (cv[0]===4)              rank = 7;
  else if (cv[0]===3&&cv[1]===2)  rank = 6;
  else if (flush)                  rank = 5;
  else if (straight||aceLow)      rank = 4;
  else if (cv[0]===3)              rank = 3;
  else if (cv[0]===2&&cv[1]===2)  rank = 2;
  else if (cv[0]===2)             rank = 1;

  return { rank, name: HAND_NAMES[rank], tiebreak: tb, best5: cards };
}

function evalHand(cards) {
  if (cards.length < 5) return { rank:0, name:'Sin cartas', best5:cards };
  const combos = getCombos(cards, 5);
  let best = null;
  for (const c of combos) {
    const v = score5(c);
    if (!best || v.rank > best.rank || (v.rank===best.rank && v.tiebreak > best.tiebreak))
      best = v;
  }
  return best;
}

// ─── ESTADO DE SALA ───────────────────────────────────────────
class PokerRoom {
  constructor(roomCode, config = {}) {
    this.code       = roomCode;
    this.smallBlind = config.smallBlind || 5;
    this.bigBlind   = config.bigBlind   || 10;
    this.startStack = config.startStack || 1000;

    this.players    = [];   // { id, name, stack, cards, bet, folded, allin, seatIndex, connected }
    this.community  = [];
    this.pot        = 0;
    this.stage      = 'waiting'; // waiting | pre | flop | turn | river | showdown
    this.currentBet = 0;
    this.dealerIdx  = 0;
    this.actionIdx  = 0;   // índice en this.players del jugador en turno
    this.deck       = [];
    this.log        = [];
    this.handNumber = 0;
    this.lastAggressor = null; // para saber cuándo termina la ronda de apuestas
    this.roundStartIdx = null;
  }

  // ── Unirse a sala ──
  addPlayer(id, name) {
    if (this.players.length >= 9) return { ok:false, reason:'Sala llena' };
    if (this.players.find(p => p.id === id)) return { ok:false, reason:'Ya estás en la sala' };
    const seatIndex = this.players.length;
    this.players.push({
      id, name, seatIndex,
      stack: this.startStack,
      cards: [], bet: 0,
      folded: false, allin: false,
      connected: true
    });
    this.addLog(`${name} se unió a la sala`);
    return { ok:true };
  }

  removePlayer(id) {
    const p = this.players.find(p => p.id === id);
    if (p) { p.connected = false; this.addLog(`${p.name} se desconectó`); }
  }

  reconnectPlayer(id) {
    const p = this.players.find(p => p.id === id);
    if (p) { p.connected = true; this.addLog(`${p.name} reconectó`); }
  }

  // ── Iniciar mano ──
  startHand() {
    const active = this.players.filter(p => p.stack > 0 && p.connected);
    if (active.length < 2) return { ok:false, reason:'Se necesitan al menos 2 jugadores' };

    this.handNumber++;
    this.deck      = makeDeck();
    this.community = [];
    this.pot       = 0;
    this.stage     = 'pre';
    this.currentBet= this.bigBlind;
    this.lastAggressor = null;

    // Reset jugadores
    this.players.forEach(p => {
      p.cards   = [];
      p.bet     = 0;
      p.folded  = !p.connected || p.stack <= 0;
      p.allin   = false;
    });

    // Rotar dealer
    const eligible = this.players.filter(p => !p.folded);
    this.dealerIdx = (this.dealerIdx + 1) % eligible.length;

    // Repartir 2 cartas a cada jugador activo
    for (const p of this.players.filter(p => !p.folded)) {
      p.cards = [this.deck.pop(), this.deck.pop()];
    }

    // Blinds
    const sbSeat = (this.dealerIdx + 1) % eligible.length;
    const bbSeat = (this.dealerIdx + 2) % eligible.length;
    this._postBlind(eligible[sbSeat], this.smallBlind);
    this._postBlind(eligible[bbSeat], this.bigBlind);
    this.lastAggressor = eligible[bbSeat].id;

    // Primer turno: jugador después del BB
    const utg = (this.dealerIdx + 3) % eligible.length;
    this.actionIdx = eligible[utg % eligible.length].seatIndex;

    this.addLog(`--- Mano #${this.handNumber} iniciada ---`);
    return { ok:true };
  }

  _postBlind(player, amount) {
    const real = Math.min(amount, player.stack);
    player.stack -= real;
    player.bet   += real;
    this.pot     += real;
    if (player.stack === 0) player.allin = true;
  }

  // ── Acción del jugador ──
  playerAction(playerId, action, amount = 0) {
    const p = this.getActivePlayer();
    if (!p || p.id !== playerId) return { ok:false, reason:'No es tu turno' };
    if (this.stage === 'waiting' || this.stage === 'showdown') return { ok:false, reason:'No hay mano activa' };

    switch (action) {
      case 'fold':  return this._fold(p);
      case 'check': return this._check(p);
      case 'call':  return this._call(p);
      case 'raise': return this._raise(p, amount);
      case 'allin': return this._allIn(p);
      default:      return { ok:false, reason:'Acción desconocida' };
    }
  }

  _fold(p) {
    p.folded = true;
    this.addLog(`${p.name}: Fold`);
    return this._next();
  }

  _check(p) {
    if (p.bet < this.currentBet) return { ok:false, reason:'No puedes hacer check, hay apuesta pendiente' };
    this.addLog(`${p.name}: Check`);
    return this._next();
  }

  _call(p) {
    const toCall = Math.min(this.currentBet - p.bet, p.stack);
    p.stack -= toCall;
    p.bet   += toCall;
    this.pot += toCall;
    if (p.stack === 0) p.allin = true;
    this.addLog(`${p.name}: Call ${toCall}`);
    return this._next();
  }

  _raise(p, totalBet) {
    const minRaise = this.currentBet * 2;
    if (totalBet < minRaise) totalBet = minRaise;
    totalBet = Math.min(totalBet, p.bet + p.stack);
    const extra = totalBet - p.bet;
    p.stack -= extra;
    p.bet    = totalBet;
    this.pot += extra;
    if (p.stack === 0) p.allin = true;
    this.currentBet    = totalBet;
    this.lastAggressor = p.id;
    this.addLog(`${p.name}: Raise → ${totalBet}`);
    return this._next();
  }

  _allIn(p) {
    const extra = p.stack;
    p.bet   += extra;
    this.pot += extra;
    p.stack  = 0;
    p.allin  = true;
    if (p.bet > this.currentBet) {
      this.currentBet    = p.bet;
      this.lastAggressor = p.id;
    }
    this.addLog(`${p.name}: All-In ${extra}`);
    return this._next();
  }

  _next() {
    const notFolded = this.players.filter(p => !p.folded);

    // Solo 1 activo → gana sin showdown
    if (notFolded.length === 1) {
      return this._awardPot(notFolded[0]);
    }

    // ¿Terminó la ronda de apuestas?
    const canAct = notFolded.filter(p => !p.allin);
    const allMatched = canAct.every(p => p.bet === this.currentBet);

    if (allMatched && (canAct.length === 0 || this._roundComplete())) {
      return this._advanceStage();
    }

    // Siguiente jugador
    this._moveToNextPlayer();
    return { ok:true, next: this.getActivePlayer()?.id };
  }

  _roundComplete() {
    // La ronda termina cuando todos los que pueden actuar igualaron
    // y el último agresor ya fue
    const canAct = this.players.filter(p => !p.folded && !p.allin);
    return canAct.every(p => p.bet === this.currentBet);
  }

  _moveToNextPlayer() {
    let idx = this.actionIdx;
    let tries = 0;
    do {
      idx = (idx + 1) % this.players.length;
      tries++;
    } while (
      (this.players[idx].folded || this.players[idx].allin) &&
      tries < this.players.length
    );
    this.actionIdx = idx;
  }

  _advanceStage() {
    // Reset apuestas para nueva ronda
    this.players.forEach(p => { if (!p.folded) p.bet = 0; });
    this.currentBet    = 0;
    this.lastAggressor = null;

    const stages = { pre:'flop', flop:'turn', turn:'river', river:'showdown' };
    this.stage = stages[this.stage] || 'showdown';

    if (this.stage === 'flop') {
      this.community = [this.deck.pop(), this.deck.pop(), this.deck.pop()];
      this.addLog('--- Flop ---');
    } else if (this.stage === 'turn') {
      this.community.push(this.deck.pop());
      this.addLog('--- Turn ---');
    } else if (this.stage === 'river') {
      this.community.push(this.deck.pop());
      this.addLog('--- River ---');
    } else if (this.stage === 'showdown') {
      return this._doShowdown();
    }

    // Primer turno post-flop: desde el dealer
    const eligible = this.players.filter(p => !p.folded && !p.allin);
    if (eligible.length > 0) {
      // Primero activo después del dealer
      let idx = (this.dealerIdx + 1) % this.players.length;
      let tries = 0;
      while ((this.players[idx].folded || this.players[idx].allin) && tries < this.players.length) {
        idx = (idx + 1) % this.players.length;
        tries++;
      }
      this.actionIdx = idx;
    }

    return { ok:true, stage: this.stage, next: this.getActivePlayer()?.id };
  }

  _doShowdown() {
    this.stage = 'showdown';
    const active = this.players.filter(p => !p.folded);
    let winner = null, bestRank = -1, bestName = '';

    active.forEach(p => {
      const h = evalHand([...p.cards, ...this.community]);
      if (h.rank > bestRank) { bestRank = h.rank; winner = p; bestName = h.name; }
    });

    this.addLog(`Showdown → ${winner.name} gana con ${bestName}`);
    return this._awardPot(winner, bestName);
  }

  _awardPot(winner, handName = '') {
    winner.stack += this.pot;
    const won = this.pot;
    this.pot   = 0;
    this.stage = 'showdown';
    this.addLog(`${winner.name} gana ${won} fichas`);
    return { ok:true, winner: winner.id, handName, won, stage:'showdown' };
  }

  // ── Helpers ──
  getActivePlayer() {
    if (this.stage === 'waiting' || this.stage === 'showdown') return null;
    return this.players[this.actionIdx] || null;
  }

  addLog(msg) {
    this.log.push({ ts: Date.now(), msg });
    if (this.log.length > 100) this.log.shift();
  }

  // Vista pública: oculta cartas de otros jugadores
  getStateFor(playerId) {
    return {
      code:      this.code,
      stage:     this.stage,
      pot:       this.pot,
      community: this.community,
      currentBet:this.currentBet,
      handNumber:this.handNumber,
      activePlayerId: this.getActivePlayer()?.id || null,
      players: this.players.map(p => ({
        id:        p.id,
        name:      p.name,
        stack:     p.stack,
        bet:       p.bet,
        folded:    p.folded,
        allin:     p.allin,
        connected: p.connected,
        isDealer:  p.seatIndex === this.dealerIdx,
        // Solo tu propio jugador ve sus cartas (o en showdown todos)
        cards: (p.id === playerId || this.stage === 'showdown') ? p.cards : p.cards.map(() => null)
      })),
      log: this.log.slice(-10)
    };
  }
}

module.exports = { PokerRoom };
