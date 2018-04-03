const RedditSocket = require('./RedditSocket');
const WebSocket = require('ws');
const os = require('os');
const url = require('url');

module.exports = class RedditCircleListener {
	constructor(config) {
		this.config = config;

		this.clients = {};

		this.stats = {
			sockets: 0,
			votes: 0,
			betrayed: 0,
		};
		this.reset30sStats();

		this.nextConnect = Date.now();

		this.socket = null;
		this.socketQueue = [];
		this.host_blacklist = [];
		this.connect();

		setInterval(() => {
			this.stats.clients = Object.keys(this.clients).length;

			console.log(Object.entries(this.stats).map(([k, v]) => `${k}: ${v}`).join(', ') + ' | ' + Object.entries(this.stats['30s']).map(([k, v]) => `${k}: ${v}`).join(', '));

			this.send('stats', this.stats);

			this.reset30sStats();
		}, 30000);
	}

	reset30sStats() {
		this.stats['30s'] = Object.keys(this.stats).reduce((acc, k) => {
			if (!['clients', '30s'].includes(k)) acc[k] = 0;
			return acc;
		}, {});
	}

	increment(stat) {
		this.stats[stat]++;
		this.stats['30s'][stat]++;
	}

	join(circleID, websocket, force = false) {
		if (this.clients[circleID]) return;

		this.increment('sockets');

		setTimeout(() => {
			if (this.host_blacklist.includes(url.parse(websocket).hostname)) {
				return;
			}

			const socket = new RedditSocket({
				main: this,
				config: this.config,
				circleID,
				websocket,
			});

			this.clients[circleID] = socket;

			socket.on('blacklist', () => {
				this.host_blacklist.push(url.parse(websocket).hostname);
			});

			socket.on('destroy', () => {
				socket.socket.close();
				this.clients[circleID] = undefined;
			});
		}, force ? 0 : Math.max(0, this.nextConnect - Date.now()));

		if (!force) this.nextConnect = Math.max(Date.now(), this.nextConnect + 200);
	}

	connect() {
		this.socket = new WebSocket(this.config.ws.server);
		this.socket.on('open', this.onOpen.bind(this));
		this.socket.on('close', this.onClose.bind(this));
		this.socket.on('message', this.onMessage.bind(this));
		this.socket.on('error', this.onError.bind(this));
	}

	send(t, d) {
		const msg = JSON.stringify({
			t,
			d,
		});

		if (this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(msg);
		} else {
			this.socketQueue.push(msg);
		}
	}

	onOpen() {
		console.log(`${Date.now()} Connected to controller`);

		this.socket.send(JSON.stringify({
			t: 'auth',
			d: {
				auth: this.config.ws.auth,
				name: os.hostname(),
				circles: Object.keys(this.clients),
			},
		}));

		this.socketQueue.forEach(d => this.socket.send(d));
		this.socketQueue = [];
	}

	onClose() {
		console.log(`${Date.now()} Disconnected from controller, reconnecting in 1s`);
		setTimeout(() => this.connect(), 1000);
	}

	onError(err) {
		console.error(err);
	}

	onMessage(data) {
		const msg = JSON.parse(data);

		if (msg.t === 'circle-join') {
			this.join(msg.d.id, msg.d.websocket);
		} else {
			console.log(`unknown type:`, msg);
		}
	}
};
