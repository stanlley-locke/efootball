let rooms = [
			{ id: 1, name: "RicoTheWall", team: "Rico United", rating: 1842, initials: "RW", stake: 200, platform: "PS5", format: "Dream Team", time: "2 min ago" },
			{ id: 2, name: "TikiTaka_7", team: "TikiTaka FC", rating: 2106, initials: "TT", stake: 500, platform: "Xbox", format: "Dream Team", time: "4 min ago" },
			{ id: 3, name: "MambaFC", team: "Mamba XI", rating: 1560, initials: "MF", stake: 100, platform: "PS5", format: "Authentic", time: "6 min ago" },
			{ id: 4, name: "elCapitano", team: "Capitano FC", rating: 1975, initials: "EC", stake: 1000, platform: "PC", format: "Dream Team", time: "9 min ago" }
		];
		const storageKey = "touchline-demo-wallet-v1";
		const initialState = { balance: 2500, locked: 0, profit: 0, deposits: [], withdrawals: [], matches: [], results: [] };
		const state = (() => { try { return { ...initialState, ...JSON.parse(localStorage.getItem(storageKey) || "{}") }; } catch { return { ...initialState }; } })();
		let activeFilter = "all";
		let activeView = "lobby";
		let selectedRoom = null;
		let activeMatchId = null;
		let serverMode = false;
		let chatPollTimer = null;
		const playerStorageKey = "touchline-demo-player-id-v1";
		const playerId = localStorage.getItem(playerStorageKey) || (() => {
			const id = globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${makeCode(20)}`;
			localStorage.setItem(playerStorageKey, id);
			return id;
		})();
		const $ = (selector) => document.querySelector(selector);
		const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
		const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
		const makeCode = (length = 6, excluded = []) => {
			const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
			let code;
			do {
				const bytes = globalThis.crypto?.getRandomValues ? crypto.getRandomValues(new Uint8Array(length)) : Array.from({ length }, () => Math.floor(Math.random() * 256));
				code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
			} while (excluded.includes(code));
			return code;
		};
		const save = () => localStorage.setItem(storageKey, JSON.stringify(state));
		async function apiRequest(path, options = {}) {
			const response = await fetch(path, {
				...options,
				headers: { "Content-Type": "application/json", "X-Touchline-Player": playerId, ...(options.headers || {}) }
			});
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error || "The shared service request failed.");
			return payload;
		}

		function mapListing(item) {
			return { id: item.id, name: item.playerName, team: item.teamName, rating: 0, initials: item.initials, stake: item.stakeCents, platform: item.platform, format: item.format, time: new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), own: item.own };
		}

		async function getSharedListings(stakeCents = null) {
			const query = new URLSearchParams({ limit: "100" });
			if (stakeCents !== null) query.set("stakeCents", String(stakeCents));
			const data = await apiRequest(`/api/feed?${query}`);
			return { items: data.items.map(mapListing), total: data.total };
		}

		async function refreshSharedMatches() {
			const data = await apiRequest("/api/matches");
			let changed = false;
			const aiSettlements = [];
			for (const remote of data.matches) {
				let match = state.matches.find((item) => item.serverMatchId === remote.id);
				if (!match) {
					const stake = remote.stakeCents;
					if (remote.status === "active" || remote.status === "waiting") {
						state.balance = Math.max(0, state.balance - stake);
						state.locked += stake;
					}
					match = { id: remote.id, serverMatchId: remote.id, code: remote.code, opponent: remote.opponentName, opponentTeam: remote.opponentTeam, playerName: remote.playerName, playerTeam: remote.playerTeam, playerCode: remote.playerCode, stake, platform: remote.platform, status: remote.status, isHost: remote.isHost, isAI: remote.opponentType === "ai", aiDifficulty: remote.aiDifficulty, aiResult: remote.aiResult, aiScoreline: remote.aiScoreline, created: remote.createdAt, remote: true, chat: [] };
					state.matches.push(match);
					changed = true;
				} else if (match.isAI && match.status === "active" && remote.status === "settled" && remote.aiResult) {
					aiSettlements.push({ match, remote });
				} else if (match.status !== remote.status || match.opponent !== remote.opponentName) {
					match.status = remote.status;
					match.opponent = remote.opponentName;
					match.opponentTeam = remote.opponentTeam;
					match.isHost = remote.isHost;
					match.aiDifficulty = remote.aiDifficulty;
					changed = true;
				}
			}
			aiSettlements.forEach(({ match, remote }) => {
				match.aiResult = remote.aiResult;
				match.aiScoreline = remote.aiScoreline;
				settleMatch(match, remote.aiResult === "player", `Full time · ${remote.aiScoreline}`);
				changed = true;
			});
			if (changed) save();
			renderAccount();
			if (activeView === "matches") renderRooms();
			const activeMatch = state.matches.find((item) => item.id === activeMatchId);
			if (changed && activeView === "matchroom" && activeMatch?.status === "active" && activeMatch.remote) enterMatchroom(activeMatch.id);
		}

		function showToast(message) {
			const toast = $("#toast");
			toast.textContent = message;
			toast.classList.add("show");
			clearTimeout(showToast.timer);
			showToast.timer = setTimeout(() => toast.classList.remove("show"), 3000);
		}

		function payoutFor(stake) { return stake * 2 - Math.round(stake * 2 * 0.30); }
		function updatePayout() {
			const stake = Math.max(0, Math.round((Number($("#stake").value) || 0) * 100));
			if ($("#opponentType").value === "ai") {
				$("#potLabel").textContent = "Your stake";
				$("#potPreview").textContent = money(stake);
				$("#feeLabel").textContent = "AI wins · no player payout";
				$("#feePreview").textContent = money(0);
				$("#winLabel").textContent = "You win · company-funded credit";
				$("#winPreview").textContent = money(payoutFor(stake));
				return;
			}
			$("#potLabel").textContent = "Combined pot";
			$("#feeLabel").textContent = "Platform fee · 30%";
			$("#winLabel").textContent = "Winner receives";
			const pot = stake * 2;
			const fee = Math.round(pot * 0.30);
			$("#potPreview").textContent = money(pot);
			$("#feePreview").textContent = `−${money(fee)}`;
			$("#winPreview").textContent = money(pot - fee);
		}

		function renderRooms() {
			const query = $("#search").value.trim().toLowerCase();
			if (activeView === "matches") {
				const matches = state.matches.filter((match) => match.status === "active" || match.status === "waiting");
				$("#roomList").innerHTML = matches.length ? matches.map((match) => `<article class="room"><div class="player"><div class="player-badge">${match.status === "waiting" ? "INV" : "VS"}</div><div><div class="player-name">${match.status === "waiting" ? "Waiting for guest" : `vs. ${escapeHTML(match.opponent)}`}</div><div class="player-meta">Room ${escapeHTML(match.code)} · ${match.status === "waiting" ? "Invite pending" : "Active"}</div></div></div><div><div class="room-label">Stake locked</div><div class="room-value stake">${money(match.stake)}</div></div><div><div class="room-label">Potential payout</div><div class="room-value">${money(payoutFor(match.stake))}</div></div><button class="join-btn" data-enter="${match.id}">Enter room</button></article>`).join("") : `<div class="empty">No active matches. Join an open challenge or create a private invite room.</div>`;
				$("#roomTotal").textContent = `${matches.length} active match${matches.length === 1 ? "" : "es"}`;
				return;
			}
			const visible = rooms.filter((room) => {
				const matchesFilter = activeFilter === "all" || (activeFilter === "low" ? room.stake < 500 : room.stake >= 500);
				const matchesSearch = `${room.name} ${room.team} ${room.platform} ${room.format}`.toLowerCase().includes(query);
				return matchesFilter && matchesSearch;
			});
			$("#roomList").innerHTML = visible.length ? visible.map((room, index) => `
				<article class="room" style="animation-delay:${index * 35}ms">
					<div class="player"><div class="player-badge">${escapeHTML(room.initials)}</div><div><div class="player-name">${escapeHTML(room.name)}</div><div class="player-meta">${room.rating ? `★ ${room.rating} · ` : ""}${escapeHTML(room.time)}</div></div></div>
					<div><div class="room-label">Equal stake</div><div class="room-value stake">${money(room.stake)}</div></div>
					<div><div class="room-label">Platform</div><div class="room-value">${escapeHTML(room.platform)}</div></div>
					<button class="join-btn" data-join="${escapeHTML(room.id)}" ${room.own ? "disabled" : ""}>${room.own ? "Your listing" : "Join match"}</button>
				</article>`).join("") : `<div class="empty">No challenges match that search. Try another filter.</div>`;
			$("#roomTotal").textContent = `${visible.length} matches waiting`;
			$("#openCount").textContent = String(rooms.length).padStart(2, "0");
			$("#navCount").textContent = rooms.length;
		}

		function renderAccount() {
			$("#walletBalance").textContent = money(state.balance);
			$("#accountBalance").textContent = money(state.balance);
			$("#accountLocked").textContent = money(state.locked);
			$("#lockedStat").textContent = money(state.locked);
			$("#accountProfit").textContent = money(state.profit);
			$("#accountProfit").className = state.profit < 0 ? "negative" : state.profit > 0 ? "positive" : "";
			const transactions = [...state.deposits.map((item) => ({ ...item, label: "Deposit" })), ...state.withdrawals.map((item) => ({ ...item, label: "Withdrawal" }))].sort((a, b) => b.time - a.time);
			$("#walletHistory").innerHTML = transactions.map((item) => `<tr><td>${item.label}</td><td>${new Date(item.time).toLocaleDateString()}</td><td class="${item.label === "Deposit" ? "positive" : ""}">${item.label === "Withdrawal" ? "−" : "+"}${money(item.amount)}</td></tr>`).join("");
			$("#walletEmpty").hidden = transactions.length > 0;
			$("#matchHistory").innerHTML = state.results.slice().reverse().map((item) => `<tr><td>${escapeHTML(item.code)} · vs. ${escapeHTML(item.opponent)}</td><td>${escapeHTML(item.outcome)}</td><td class="${item.net >= 0 ? "positive" : "negative"}">${item.net > 0 ? "+" : ""}${money(item.net)}</td></tr>`).join("");
			$("#matchHistoryEmpty").hidden = state.results.length > 0;
			$("#recentList").innerHTML = state.results.slice(-3).reverse().map((item) => `<div class="recent-item"><div><div class="recent-name">${item.won ? "Win" : "Loss"} · ${escapeHTML(item.code)}</div><div class="recent-sub">vs. ${escapeHTML(item.opponent)}</div></div><span class="result ${item.net < 0 ? "loss" : ""}">${item.net > 0 ? "+" : ""}${money(item.net)}</span></div>`).join("") || `<div class="account-empty">No settled matches yet.</div>`;
		}

		function openJoin(room) {
			selectedRoom = room;
			const pot = room.stake * 2;
			$("#confirmSummary").innerHTML = `<div class="payout-line"><span>Opponent</span><strong>${escapeHTML(room.name)} · ${escapeHTML(room.platform)}</strong></div><div class="payout-line"><span>Equal stake</span><strong>${money(room.stake)}</strong></div><div class="payout-line"><span>Winner payout after 30% fee</span><strong>${money(payoutFor(room.stake))}</strong></div><div class="field" style="margin-top:14px"><label for="joiningTeam">Your team name for this match</label><input id="joiningTeam" maxlength="24" value="Jordan FC" required></div><label class="rule-check"><input id="chatRules" type="checkbox" required><span>I will coordinate this match only through the website's matchroom chat.</span></label>`;
			$("#confirmJoin").disabled = false;
			$("#confirmJoin").innerHTML = "Confirm stake & enter <span>→</span>";
			$("#overlay").classList.add("open");
		}

		function closeJoin() { $("#overlay").classList.remove("open"); selectedRoom = null; }

		function showView(view) {
			activeView = view;
			if (view !== "matchroom" && chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
			$("#lobbyContent").hidden = view === "account" || view === "matchroom" || view === "stakeroom";
			$("#accountView").hidden = view !== "account";
			$("#stakeRoomView").hidden = view !== "stakeroom";
			$("#matchView").hidden = view !== "matchroom";
			document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view || (view === "matchroom" && item.dataset.view === "matches")));
			$("#crumbCurrent").textContent = view === "account" ? "Account centre" : view === "stakeroom" ? "StakeRoom" : view === "matches" ? "My matches" : view === "matchroom" ? "Matchroom" : view === "leaderboard" ? "Leaderboard" : "Open lobby";
			if (view !== "account" && view !== "matchroom" && view !== "stakeroom") {
				const config = {
					lobby: ["FIND YOUR MATCH.", "Pick an equal stake. Find your opponent. Let the match decide.", "Open challenges"],
					matches: ["YOUR NEXT MATCH.", "Your active matchrooms and locked stakes.", "My matches"],
					leaderboard: ["THE LADDER.", "Find your next opponent in the open eFootball lobby.", "Top open challenges"]
				}[view];
				$("#pageTitle").textContent = config[0];
				$("#pageSubtitle").textContent = config[1];
				$("#roomHeading").textContent = config[2];
				$("#filters").style.display = view === "matches" ? "none" : "flex";
				renderRooms();
			} else if (view === "account") renderAccount();
			else if (view === "stakeroom") renderStakeRoom();
		}

		async function renderStakeRoom() {
			const stake = Math.round(Number($("#stakeSearchAmount").value) * 100);
			let matchingRooms = rooms.filter((room) => room.stake === stake);
			let total = matchingRooms.length;
			if (serverMode && Number.isFinite(stake)) {
				try {
					const response = await getSharedListings(stake);
					matchingRooms = response.items;
					total = response.total;
				} catch (error) { showToast(error.message); }
			}
			$("#stakeRoomCount").textContent = `${total} exact-stake listing${total === 1 ? "" : "s"}`;
			$("#feedStatus").textContent = `${serverMode ? "Shared feed" : "Demo feed"} · refreshed ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
			$("#stakeFeed").innerHTML = matchingRooms.length ? matchingRooms.map((room) => `<article class="stake-match"><div class="player"><div class="player-badge">${escapeHTML(room.initials)}</div><div><div class="player-name">${escapeHTML(room.name)}</div><div class="player-meta">${escapeHTML(room.team)} · ${escapeHTML(room.platform)} · ${escapeHTML(room.format)}</div></div></div><div><div class="room-label">Exact stake</div><div class="room-value stake">${money(room.stake)}</div></div><div><div class="room-label">Winner gets</div><div class="room-value">${money(payoutFor(room.stake))}</div></div><button class="join-btn" data-stake-join="${escapeHTML(room.id)}" ${room.own ? "disabled" : ""}>${room.own ? "Your listing" : "Match"}</button></article>`).join("") : `<div class="empty">No players are listing exactly ${money(stake)} right now. Try another amount or refresh shortly.</div>`;
		}

		async function refreshOpenFeed() {
			const response = await getSharedListings();
			rooms = response.items;
			renderRooms();
			if (activeView === "stakeroom") await renderStakeRoom();
		}

		async function connectSharedService() {
			if (!/^https?:$/.test(location.protocol)) return;
			try {
				await apiRequest("/api/health");
				serverMode = true;
				await refreshOpenFeed();
				await refreshSharedMatches();
				showToast("Connected to shared StakeRoom and match chat.");
			} catch (error) {
				serverMode = false;
				console.warn("Touchline shared service is unavailable:", error.message);
			}
		}

		const connectionGraceMs = 120000;
		let connectionAvailable = navigator.onLine;
		function updateConnectionStatus() {
			const banner = $("#connectionStatus");
			const match = state.matches.find((item) => item.id === activeMatchId && item.status === "active");
			if (!banner || !match) return;
			const lostAt = match.connectionLostAt;
			if (connectionAvailable && !lostAt) {
				banner.classList.remove("offline");
				banner.textContent = "Connection detected · No match-count limit; available wallet balance applies.";
				return;
			}
			const remaining = Math.max(0, connectionGraceMs - (Date.now() - (lostAt || Date.now())));
			const seconds = Math.ceil(remaining / 1000);
			banner.classList.add("offline");
			banner.textContent = `Connection unavailable · forfeit in ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
		}

		function syncConnectionState(available) {
			connectionAvailable = available;
			const now = Date.now();
			const toForfeit = [];
			let changed = false;
			state.matches.filter((item) => item.status === "active").forEach((match) => {
				if (!available && !match.connectionLostAt) {
					match.connectionLostAt = now;
					changed = true;
				}
				if (match.connectionLostAt && now - match.connectionLostAt >= connectionGraceMs) {
					toForfeit.push(match);
				} else if (available && match.connectionLostAt) {
					delete match.connectionLostAt;
					changed = true;
				}
			});
			if (changed) save();
			toForfeit.forEach((match) => settleMatch(match, false, "Connection unavailable for 2 minutes"));
			updateConnectionStatus();
		}

		function enterMatchroom(matchId) {
			const match = state.matches.find((item) => item.id === matchId && (item.status === "active" || item.status === "waiting"));
			if (!match) return;
			if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
			match.chat ||= [];
			activeMatchId = match.id;
			$("#matchView").innerHTML = `<div class="heading-row"><div><div class="eyebrow"><span></span> Matchroom · ${escapeHTML(match.platform)}</div><h1>ROOM ${escapeHTML(match.code)}.</h1><p class="subtitle">Room code is for both players. Never share your private player code.</p></div><button class="secondary-btn" id="backMatches">← My matches</button></div><div class="match-layout"><section class="match-panel"><div class="panel-head"><h2 class="panel-title">Match details</h2><span class="room-total">Active · ${money(match.stake)} each</span></div><div class="match-body"><div class="payout-box"><div class="payout-line"><span>Combined locked pot</span><strong>${money(match.stake * 2)}</strong></div><div class="payout-line"><span>30% commission</span><strong>−${money(match.stake * 2 - payoutFor(match.stake))}</strong></div><div class="payout-line total"><span>Winner receives</span><strong>${money(payoutFor(match.stake))}</strong></div></div><div class="match-sides"><div class="match-side"><small>YOU · ${escapeHTML(match.playerName)}</small><strong>${escapeHTML(match.playerTeam)}</strong><small>Your private verification code</small><span class="private-code">${escapeHTML(match.playerCode)}</span></div><div class="match-side"><small>OPPONENT · ${escapeHTML(match.opponent)}</small><strong>${escapeHTML(match.opponentTeam)}</strong><small>Opponent's private code is not shown to you.</small><span class="private-code">••••••</span></div></div><p class="match-note">Team names are fixed for this match. At full time, the winner submits a score screenshot and the private code assigned to their team name. This browser demo requires an image but does not independently verify it.</p><div class="match-actions"><button class="secondary-btn" id="forfeitSelf">Forfeit match</button><button class="secondary-btn" id="forfeitOpponent">Opponent forfeited · demo</button></div></div></section><section class="match-panel"><div class="panel-head"><h2 class="panel-title">Full-time result</h2></div><form class="proof-form" id="proofForm"><div class="field"><label for="scoreline">Scoreline</label><input id="scoreline" placeholder="e.g. 2 - 1" maxlength="12" required></div><div class="field"><label for="winner">Winner / team name</label><select id="winner"><option value="player">${escapeHTML(match.playerTeam)} · ${escapeHTML(match.playerName)}</option><option value="opponent">${escapeHTML(match.opponentTeam)} · ${escapeHTML(match.opponent)}</option></select></div><div class="field"><label for="winnerCode">Winner's private code</label><input id="winnerCode" autocomplete="off" required></div><div class="field"><label for="scoreProof">Score screenshot</label><input id="scoreProof" type="file" accept="image/*" required></div><div id="proofName" class="match-note">Image required to submit a full-time result.</div><button class="primary-btn create-submit" type="submit">Submit result & settle</button></form></section></div>`;
			if (match.isAI) {
				$("#matchView .match-layout > .match-panel:first-child .room-total").textContent = `eFootball AI · ${match.aiDifficulty}`;
				const payoutLines = $("#matchView .payout-box").querySelectorAll(".payout-line");
				payoutLines[0].querySelector("span").textContent = "Your stake";
				payoutLines[0].querySelector("strong").textContent = money(match.stake);
				payoutLines[1].querySelector("span").textContent = "AI win · no player payout";
				payoutLines[1].querySelector("strong").textContent = money(0);
				payoutLines[2].querySelector("span").textContent = "You win · company-funded credit";
				payoutLines[2].querySelector("strong").textContent = money(payoutFor(match.stake));
				$("#matchView .match-sides .match-side:last-child small").textContent = `OPPONENT · eFootball AI · ${match.aiDifficulty}`;
				$("#matchView .match-sides .match-side:last-child strong").textContent = "Computer-controlled team";
				$("#matchView .match-sides .match-side:last-child small:nth-of-type(2)").textContent = "No player verification code";
				$("#matchView .match-sides .match-side:last-child .private-code").remove();
				$("#matchView .match-layout > .match-panel:first-child .match-note").textContent = "Play the selected difficulty in eFootball, then upload a score screenshot. This demo cannot verify the console result. A claimed win credits 1.4× your stake; an AI win loses your stake.";
				$("#forfeitOpponent").hidden = true;
				$("#winner").innerHTML = `<option value="player">${escapeHTML(match.playerTeam)} · ${escapeHTML(match.playerName)}</option><option value="opponent">eFootball AI · ${escapeHTML(match.aiDifficulty)}</option>`;
				const codeField = $("#winnerCode").closest(".field");
				const updateCodeField = () => { const isPlayerWinner = $("#winner").value === "player"; codeField.hidden = !isPlayerWinner; $("#winnerCode").required = isPlayerWinner; };
				$("#winner").addEventListener("change", updateCodeField);
				updateCodeField();
			}
			$("#matchView").insertAdjacentHTML("afterbegin", `<div class="connection-banner" id="connectionStatus" role="status" aria-live="polite"></div><p class="match-note">Demo connection checks use this browser's online/offline signal. Accurate lag detection and opponent timeouts require server heartbeats.</p>`);
			if (match.remote && match.isHost && match.status === "waiting") {
				$("#matchView").insertAdjacentHTML("afterbegin", `<section class="match-panel section-gap"><div class="panel-head"><h2 class="panel-title">Invite your opponent</h2><span class="room-total">Waiting for one guest</span></div><div class="match-body"><p class="match-note">Send this unique room code through your preferred messaging channel. Your stake stays locked while the room waits.</p><div class="payout-box"><div class="payout-line total"><span>Shareable match code</span><strong id="shareRoomCode">${escapeHTML(match.code)}</strong></div></div><button class="secondary-btn" type="button" id="copyRoomCode">Copy invite code</button></div></section>`);
				$("#copyRoomCode").addEventListener("click", async () => {
					try { await navigator.clipboard.writeText(match.code); showToast("Invite code copied."); }
					catch { showToast(`Share this invite code: ${match.code}`); }
				});
			}
			if (match.status === "waiting") {
				$("#matchView .match-layout > .match-panel:first-child .room-total").textContent = "Waiting for guest · stake locked";
				$("#matchView .match-sides .match-side:last-child").innerHTML = `<small>OPPONENT</small><strong>Waiting for your invited guest</strong><small>They can join with the room code.</small>`;
				$("#proofForm").closest(".match-panel").hidden = true;
				$("#forfeitOpponent").hidden = true;
			}
			$("#matchView").insertAdjacentHTML("beforeend", `<section class="match-panel chat-panel"><div class="panel-head"><h2 class="panel-title">Matchroom chat</h2><span class="room-total">Private to this match · demo</span></div><div class="chat-messages" id="matchChatMessages" role="log" aria-live="polite"></div><form class="chat-compose" id="matchChatForm"><input id="matchChatInput" maxlength="300" placeholder="Message your opponent" aria-label="Message your opponent" required><button class="primary-btn" type="submit">Send</button></form><div class="chat-actions"><button class="secondary-btn" type="button" id="quickGreeting">Send quick greeting</button></div><p class="match-note" style="padding:0 17px 15px">Keep all match coordination in this website's chat. The demo cannot enforce external communication rules.</p></section>`);
			$("#matchView .chat-panel .room-total").textContent = match.remote ? "Shared chat · server polled" : "Private to this match · demo";
			if (match.status === "waiting") $("#matchView .chat-panel").hidden = true;
			if (match.isAI) $("#matchView .chat-panel").hidden = true;
			function renderMatchChat() {
				$("#matchChatMessages").innerHTML = match.chat.length ? match.chat.map((message) => `<article class="chat-message"><div class="chat-message-head"><strong>${escapeHTML(message.name)}</strong><time>${new Date(Number(message.time)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><p>${escapeHTML(message.text)}</p></article>`).join("") : `<div class="account-empty">Start the match conversation here.</div>`;
				$("#matchChatMessages").scrollTop = $("#matchChatMessages").scrollHeight;
			}
			async function syncMatchChat() {
				if (!serverMode || !match.remote || activeMatchId !== match.id) return;
				try {
					const latestId = match.chat.reduce((latest, item) => Math.max(latest, Number(item.id) || 0), 0);
					const data = await apiRequest(`/api/matches/${match.serverMatchId}/messages?after=${latestId}`);
					if (!data.messages.length) return;
					match.chat.push(...data.messages);
					save();
					renderMatchChat();
				} catch (error) { showToast(error.message); }
			}
			async function sendChatMessage(text) {
				const cleanText = text.trim();
				if (!cleanText) return;
				if (serverMode && match.remote) {
					try {
						await apiRequest(`/api/matches/${match.serverMatchId}/messages`, { method: "POST", body: JSON.stringify({ message: cleanText }) });
						$("#matchChatInput").value = "";
						await syncMatchChat();
					} catch (error) { showToast(error.message); }
					return;
				}
				match.chat.push({ name: match.playerName, text: cleanText, time: Date.now() });
				save();
				renderMatchChat();
				$("#matchChatInput").value = "";
			}
			renderMatchChat();
			$("#matchChatForm").addEventListener("submit", (event) => { event.preventDefault(); sendChatMessage($("#matchChatInput").value); });
			$("#quickGreeting").addEventListener("click", () => sendChatMessage("hi, Im online lets kick the ball"));
			if (serverMode && match.remote) {
				syncMatchChat();
				chatPollTimer = setInterval(syncMatchChat, 2000);
			}
			updateConnectionStatus();
			$("#backMatches").addEventListener("click", () => showView("matches"));
			$("#forfeitSelf").addEventListener("click", () => settleMatch(match, false, "Forfeit"));
			$("#forfeitOpponent").addEventListener("click", () => settleMatch(match, true, "Opponent forfeited"));
			$("#scoreProof").addEventListener("change", (event) => { $("#proofName").textContent = event.target.files[0]?.name || "Image required to submit a full-time result."; });
			$("#proofForm").addEventListener("submit", async (event) => {
				event.preventDefault();
				const winner = $("#winner").value;
				const expectedCode = winner === "player" ? match.playerCode : match.opponentCode;
				const proof = $("#scoreProof").files[0];
				if (!proof || !proof.type.startsWith("image/")) return showToast("Upload an image of the final scoreline.");
				if (!(match.isAI && winner === "opponent") && $("#winnerCode").value.trim().toUpperCase() !== expectedCode) return showToast("That code does not match the selected winner and team.");
				const scoreline = $("#scoreline").value.trim();
				if (!/^\d+\s*[-:]\s*\d+$/.test(scoreline)) return showToast("Enter a scoreline such as 2 - 1.");
				if (match.isAI && match.remote) {
					try {
						const body = new FormData();
						body.append("winner", winner === "player" ? "player" : "ai");
						body.append("scoreline", scoreline);
						body.append("scoreProof", proof);
						const response = await fetch(`/api/matches/${match.serverMatchId}/ai-result`, { method: "POST", headers: { "X-Touchline-Player": playerId }, body });
						const result = await response.json();
						if (!response.ok) throw new Error(result.error || "AI result could not be settled.");
						if (result.payoutCents !== payoutFor(match.stake) * (winner === "player" ? 1 : 0)) throw new Error("The server payout did not match the displayed estimate.");
					} catch (error) { showToast(error.message); return; }
				}
				settleMatch(match, winner === "player", `Full time · ${$("#scoreline").value.trim()}`);
			});
			showView("matchroom");
		}

		function settleMatch(match, playerWon, outcome) {
			if (match.status !== "active") return;
			const payout = payoutFor(match.stake);
			state.locked = Math.max(0, state.locked - match.stake);
			if (playerWon) state.balance += payout;
			const net = playerWon ? payout - match.stake : -match.stake;
			state.profit += net;
			match.status = "settled";
			delete match.connectionLostAt;
			state.results.push({ code: match.code, opponent: match.opponent, won: playerWon, outcome, net, time: Date.now() });
			if (activeMatchId === match.id) activeMatchId = null;
			save();
			renderAccount();
			showToast(playerWon ? `Demo result accepted. ${money(payout)} credited to your demo wallet.` : `Match settled. Your ${money(match.stake)} stake was lost.`);
			showView("matches");
		}

		$("#stake").addEventListener("input", updatePayout);
		function updateOpponentOptions() {
			const isAI = $("#opponentType").value === "ai";
			$("#aiDifficultyField").hidden = !isAI;
			$("#challengeVisibility").closest(".field").hidden = isAI;
			updatePayout();
		}
		$("#opponentType").addEventListener("change", updateOpponentOptions);
		$("#search").addEventListener("input", renderRooms);
		$("#walletShortcut").addEventListener("click", () => showView("account"));
		$("#filters").addEventListener("click", (event) => {
			const button = event.target.closest("[data-filter]");
			if (!button) return;
			activeFilter = button.dataset.filter;
			document.querySelectorAll(".filter-btn").forEach((filter) => filter.classList.toggle("active", filter === button));
			renderRooms();
		});
		$("#stakeSearchForm").addEventListener("submit", (event) => { event.preventDefault(); renderStakeRoom(); });
		$("#joinCodeForm").addEventListener("submit", async (event) => {
			event.preventDefault();
			if (!serverMode) return showToast("Start the PHP server to join shared invite rooms.");
			try {
				const remote = await apiRequest("/api/matches/join", { method: "POST", body: JSON.stringify({ matchCode: $("#joinRoomCode").value.trim(), playerName: "Jordan Davis", teamName: $("#joinCodeTeam").value.trim(), availableCents: state.balance }) });
				const match = { id: remote.id, serverMatchId: remote.id, code: remote.code, opponent: remote.opponentName, opponentTeam: remote.opponentTeam, playerName: remote.playerName, playerTeam: remote.playerTeam, playerCode: remote.playerCode, stake: remote.stakeCents, platform: remote.platform, status: remote.status, isHost: false, created: remote.createdAt, remote: true, chat: [] };
				state.balance -= match.stake;
				state.locked += match.stake;
				state.matches.push(match);
				save();
				renderAccount();
				$("#joinRoomCode").value = "";
				enterMatchroom(match.id);
			} catch (error) { showToast(error.message); }
		});
		$("#stakeRoomView").addEventListener("click", (event) => {
			const button = event.target.closest("[data-stake-join]");
			const room = button && rooms.find((item) => String(item.id) === button.dataset.stakeJoin);
			if (room) openJoin(room);
		});
		$(".nav-list").addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (button) showView(button.dataset.view); });
		$("#roomList").addEventListener("click", (event) => {
			const enter = event.target.closest("[data-enter]");
			if (enter) return enterMatchroom(Number(enter.dataset.enter));
			const button = event.target.closest("[data-join]");
			const room = button && rooms.find((item) => String(item.id) === button.dataset.join);
			if (room) openJoin(room);
		});
		$("#createForm").addEventListener("submit", async (event) => {
			event.preventDefault();
			const stake = Math.round(Number($("#stake").value) * 100);
			if (!Number.isSafeInteger(stake) || stake < 100) return showToast("Minimum stake is $1.00.");
			if (stake > state.balance) return showToast("Insufficient available balance for that stake.");
			if ($("#opponentType").value === "ai") {
				if (!serverMode) return showToast("Start the PHP server to create an AI match.");
				try {
					const difficulty = $("#aiDifficulty").value;
					const remote = await apiRequest("/api/matches", { method: "POST", body: JSON.stringify({ playerName: "Jordan Davis", teamName: $("#teamName").value.trim(), stakeCents: stake, platform: $("#platform").value.replace("PlayStation ", "PS"), format: $("#matchType").value.includes("Dream") ? "Dream Team" : "Authentic", opponentType: "ai", aiDifficulty: difficulty }) });
					const match = { id: remote.id, serverMatchId: remote.id, code: remote.code, opponent: remote.opponentName, opponentTeam: remote.opponentTeam, playerName: remote.playerName, playerTeam: remote.playerTeam, playerCode: remote.playerCode, stake: remote.stakeCents, platform: remote.platform, status: "active", isAI: true, aiDifficulty: difficulty, created: remote.createdAt, remote: true, chat: [] };
					state.balance -= stake;
					state.locked += stake;
					state.matches.push(match);
					save();
					renderAccount();
					enterMatchroom(match.id);
					showToast(`AI match created · ${difficulty}. Play in eFootball, then submit your score screenshot.`);
					return;
				} catch (error) { showToast(error.message); return; }
			}
			if ($("#challengeVisibility").value === "private") {
				if (!serverMode) return showToast("Start the PHP server to create a shareable invite room.");
				try {
					const remote = await apiRequest("/api/matches", { method: "POST", body: JSON.stringify({ playerName: "Jordan Davis", teamName: $("#teamName").value.trim(), stakeCents: stake, platform: $("#platform").value.replace("PlayStation ", "PS"), format: $("#matchType").value.includes("Dream") ? "Dream Team" : "Authentic" }) });
					const match = { id: remote.id, serverMatchId: remote.id, code: remote.code, opponent: "", opponentTeam: "", playerName: remote.playerName, playerTeam: remote.playerTeam, playerCode: remote.playerCode, stake: remote.stakeCents, platform: remote.platform, status: "waiting", isHost: true, created: remote.createdAt, remote: true, chat: [] };
					state.balance -= stake;
					state.locked += stake;
					state.matches.push(match);
					save();
					renderAccount();
					enterMatchroom(match.id);
					showToast(`Invite room ${match.code} created. Share this code with your opponent.`);
					return;
				} catch (error) { showToast(error.message); return; }
			}
			if (serverMode) {
				try {
					await apiRequest("/api/listings", { method: "POST", body: JSON.stringify({ playerName: "JordanD", teamName: $("#teamName").value.trim(), stakeCents: stake, platform: $("#platform").value.replace("PlayStation ", "PS"), format: $("#matchType").value.includes("Dream") ? "Dream Team" : "Authentic" }) });
					await refreshOpenFeed();
					showToast("Your challenge is live in the shared StakeRoom feed.");
					return;
				} catch (error) { showToast(error.message); return; }
			}
			rooms.unshift({ id: Date.now(), name: "JordanD", team: $("#teamName").value.trim(), rating: 1724, initials: "JD", stake, platform: $("#platform").value.replace("PlayStation ", "PS"), format: $("#matchType").value.includes("Dream") ? "Dream Team" : "Authentic", time: "just now", own: true });
			renderRooms();
			showToast("Challenge posted. Your stake is only locked when a match begins.");
			$("#roomList").scrollIntoView({ behavior: "smooth", block: "start" });
		});
		$("#focusCreate").addEventListener("click", () => { $("#stake").focus({ preventScroll: true }); $("#createPanel").scrollIntoView({ behavior: "smooth", block: "center" }); });
		$("#closeDialog").addEventListener("click", closeJoin);
		$("#cancelJoin").addEventListener("click", closeJoin);
		$("#overlay").addEventListener("click", (event) => { if (event.target === $("#overlay")) closeJoin(); });
		document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeJoin(); });
		$("#confirmJoin").addEventListener("click", async () => {
			if (!selectedRoom) return;
			if (selectedRoom.own) return showToast("You cannot join your own challenge.");
			if (!$("#chatRules")?.checked) return showToast("Agree to keep match coordination in the matchroom chat.");
			if (selectedRoom.stake < 100) return showToast("Minimum stake is $1.00.");
			if (selectedRoom.stake > state.balance) return showToast("Insufficient available balance to join this match.");
			const playerTeam = $("#joiningTeam").value.trim();
			if (!playerTeam) return showToast("Enter your team name before confirming.");
			let match;
			if (serverMode) {
				try {
					const remote = await apiRequest(`/api/listings/${encodeURIComponent(selectedRoom.id)}/join`, { method: "POST", body: JSON.stringify({ playerName: "Jordan Davis", teamName: playerTeam }) });
					match = { id: remote.id, serverMatchId: remote.id, code: remote.code, opponent: remote.opponentName, opponentTeam: remote.opponentTeam, playerName: remote.playerName, playerTeam: remote.playerTeam, playerCode: remote.playerCode, stake: remote.stakeCents, platform: remote.platform, status: "active", created: Date.now(), remote: true, chat: [] };
				} catch (error) { showToast(error.message); await refreshOpenFeed(); return; }
			} else {
				const usedCodes = state.matches.flatMap((item) => [item.code.replace(/^TL-/, ""), item.playerCode, item.opponentCode]);
				const roomCode = makeCode(6, usedCodes);
				usedCodes.push(roomCode);
				const playerCode = makeCode(6, usedCodes);
				usedCodes.push(playerCode);
				match = { id: Date.now(), code: `TL-${roomCode}`, opponent: selectedRoom.name, opponentTeam: selectedRoom.team, playerName: "Jordan Davis", playerTeam, playerCode, opponentCode: makeCode(6, usedCodes), stake: selectedRoom.stake, platform: selectedRoom.platform, status: "active", created: Date.now(), chat: [] };
			}
			state.balance -= selectedRoom.stake;
			state.locked += selectedRoom.stake;
			state.matches.push(match);
			rooms = rooms.filter((room) => String(room.id) !== String(selectedRoom.id));
			save();
			closeJoin();
			renderAccount();
			renderRooms();
			enterMatchroom(match.id);
			if (serverMode) { refreshOpenFeed(); refreshSharedMatches(); }
		});
		$("#depositForm").addEventListener("submit", (event) => {
			event.preventDefault();
			const amount = Math.round(Number($("#depositAmount").value) * 100);
			if (!Number.isSafeInteger(amount) || amount < 100) return showToast("Minimum deposit is $1.00.");
			state.balance += amount;
			state.deposits.push({ amount, time: Date.now() });
			save(); renderAccount();
			showToast(`${money(amount)} demo funds added to your available balance.`);
		});
		$("#withdrawForm").addEventListener("submit", (event) => {
			event.preventDefault();
			const amount = Math.round(Number($("#withdrawAmount").value) * 100);
			if (!Number.isSafeInteger(amount) || amount < 1) return showToast("Enter a withdrawal amount greater than zero.");
			if (amount > state.balance) return showToast("Withdrawal exceeds your available balance; locked stakes cannot be withdrawn.");
			state.balance -= amount;
			state.withdrawals.push({ amount, time: Date.now() });
			save(); renderAccount();
			showToast(`${money(amount)} demo funds withdrawn from your available balance.`);
		});
		window.addEventListener("offline", () => syncConnectionState(false));
		window.addEventListener("online", () => syncConnectionState(true));
		setInterval(() => syncConnectionState(connectionAvailable && navigator.onLine), 1000);
		setInterval(() => { if (activeView === "stakeroom") renderStakeRoom(); }, 15000);
		setInterval(async () => {
			if (!serverMode) return;
			try {
				if (activeView === "lobby" || activeView === "stakeroom") await refreshOpenFeed();
				await refreshSharedMatches();
			} catch (error) { console.warn("Touchline refresh failed:", error.message); }
		}, 5000);
		$("#stakeSearchAmount").addEventListener("input", renderStakeRoom);

		renderRooms();
		renderAccount();
		updatePayout();
		updateOpponentOptions();
		connectSharedService();
		syncConnectionState(navigator.onLine);