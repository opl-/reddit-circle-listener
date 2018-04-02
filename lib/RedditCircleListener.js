const RedditSocket = require('./RedditSocket');
const mysql = require('mysql2/promise');
const request = require('./request');
const WebSocket = require('ws');

module.exports = class RedditCircleListener {
	constructor(config) {
		this.mysqlPool = mysql.createPool(config.mysql);

		this.clients = {};

		this.joinFromDB();

		this.stats = {
			sockets: 0,
			votes: 0,
			betrayed: 0,
		};
		this.reset30sStats();

		this.nextConnect = Date.now();

		this.connect();

		setInterval(() => {
			this.stats.clients = Object.keys(this.clients).length;

			console.log(Object.entries(this.stats).map(([k, v]) => `${k}: ${v}`).join(', ') + ' | ' + Object.entries(this.stats['30s']).map(([k, v]) => `${k}: ${v}`).join(', '));
			this.reset30sStats();
		}, 30000);
	}

	connect() {
		this.socket = new WebSocket('ws://127.0.0.1:57086');
		this.socket.onopen = this.onOpen.bind(this);
		this.socket.onclose = this.onClose.bind(this);
		this.socket.onmessage = this.onMessage.bind(this);
	}

	reset30sStats() {
		this.stats['30s'] = Object.keys(this.stats).reduce((acc, k) => {
			acc[k] = 0;
			return acc;
		}, {});
	}

	increment(stat) {
		this.stats[stat]++;
		this.stats['30s'][stat]++;
	}

	async joinFromDB() {
		const {conn, callback} = await this.getMySQLConnection();

		const [result] = await conn.query('SELECT `id`, `websocket` FROM `Circle` WHERE `betrayed` = 0 ORDER BY `created` DESC');

		result.forEach((r) => {
			this.join(r.id, r.websocket);
		});
	
		callback();
	}

	join(circleID, websocket, force = false) {
		if (this.clients[circleID]) return;

		this.increment('sockets');

		setTimeout(() => {
			const socket = new RedditSocket({
				main: this,
				config: this.config,
				circleID,
				websocket,
			});

			this.clients[circleID] = socket;

			socket.on('destroy', () => {
				socket.socket.close();
				this.clients[circleID] = undefined;
			});
		}, force ? 0 : Math.max(0, this.nextConnect - Date.now()));

		if (!force) this.nextConnect = Math.max(Date.now(), this.nextConnect + 200);
	}

	onOpen() {
		console.log(`${Date.now()} Connected to controller`);
		this.socket.send(JSON.stringify({
			t: 'listen',
			d: {
				name: 'listener1',
			},
		}));
	}

	onClose() {
		console.log(`${Date.now()} Disconnected from controller, reconnecting in 1s`);
		setTimeout(() => this.connect(), 1000);
	}

	onMessage({data}) {
		const msg = JSON.parse(data);

		if (msg.t === 'circle-new') {
			this.join(msg.d.id, msg.d.websocket);
		} else {
			console.log(`unknown type:`, msg);
		}
	}

	async getMySQLConnection() {
		const conn = await this.mysqlPool.getConnection();
		await conn.query('BEGIN');

		return {
			conn,
			async callback(err) {
				if (err && err !== 'request failed') console.error(err);

				await conn.query(err ? 'ROLLBACK' : 'COMMIT');
				conn.release();
			},
		};
	}
};
