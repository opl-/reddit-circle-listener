const WebSocket = require('ws');
const {EventEmitter} = require('events');

module.exports = class RedditSocket extends EventEmitter {
	constructor({main, config, circleID, websocket}) {
		super();

		this.main = main;
		this.config = config;

		this.circleID = circleID;
		this.websocket = websocket;

		this.sendQueue = [];

		this.connect();
	}

	connect() {
		this.socket = new WebSocket(this.websocket);

		this.socket.on('open', this.onOpen.bind(this));
		this.socket.on('close', this.onClose.bind(this));
		this.socket.on('message', this.onMessage.bind(this));
		this.socket.on('error', this.onError.bind(this));
	}

	close() {
		this.closed = true;
		this.socket.close();
	}

	send(msg) {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			this.sendQueue.push(msg);
		} else {
			this.socket.send(msg);
		}
	}

	onOpen() {
		console.log(`${Date.now()} ${this.circleID} Socket open.`);

		this.sendQueue.forEach((msg) => {
			this.socket.send(msg);
		});

		this.sendQueue.splice(0);
	}

	onClose() {
		console.log(`${Date.now()} ${this.circleID} Socket closed${!this.closed ? ', reconnecting in 1s' : ''}`);

		this.socket = null;

		if (!this.closed) setTimeout(() => this.connect(), 1000);
	}

	onError(err) {
		if (err.code === 'ENOTFOUND') {
			console.warn(`${Date.now()} ${this.circleID} Blacklisting socket ${this.websocket}`)
			this.emit('blacklist');
		} else {
			console.error(err);
		}

		this.close();
	}

	async onMessage(data) {
		const d = JSON.parse(data);

		if (d.type === 'new_vote') {
			const betrayed = d.payload.direction === -1;

			this.main.increment('votes');
			if (betrayed) this.main.increment('betrayed');

			this.main.send('circle-status', {
				id: d.thing_fullname.substr(3),
				timestamp: Date.now(),
				score: d.payload.total_count,
				betrayed,
				outside: d.payload.circle_num_outside,
			});

			if (betrayed) setTimeout(() => this.emit('destroy'), 2000);
		} else {
			this.main.send('unknown-type', d);
			console.log('unknown type:', JSON.stringify(d));
		}
	}
};
