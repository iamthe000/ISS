const UNIT_TYPES = {
    infantry: { name: "歩兵", atk: 1.0, def: 1.0, icon: "🛡️", desc: "標準的な部隊。攻守のバランスが良い。" },
    cavalry: { name: "騎兵", atk: 1.2, def: 0.8, icon: "🐎", desc: "攻撃に優れ、弓兵に強いが槍兵に弱い。", bonusAgainst: "archers" },
    spearmen: { name: "槍兵", atk: 0.9, def: 1.1, icon: "🔱", desc: "防御に優れ、騎兵に強いが弓兵に弱い。", bonusAgainst: "cavalry" },
    archers: { name: "弓兵", atk: 1.1, def: 0.7, icon: "🏹", desc: "遠距離攻撃が得意で、槍兵に強いが騎兵に弱い。", bonusAgainst: "spearmen" }
};

const CONFIG = {
    TILE_SIZE: 16,
    SEA_ID: 0,
    SPEED_MS: { 1: 500, 2: 250, 3: 100, 4: 50, 5: 10 },
    HOURS_PER_TICK: 6, 
    DAYS_PER_MONTH: 30,
    BASE_YEAR: 1936,
    COLORS: [
        '#1a1a1a', 
        '#8b0000', '#006400', '#00008b', '#8b8b00', '#8b008b', 
        '#008b8b', '#a52a2a', '#d2691e', '#556b2f', '#483d8b',
        '#2f4f4f', '#800000', '#191970', '#808000', '#4b0082'
    ],
    COST_DIVISION_IC: 10,
    COST_DIVISION_MP: 1000,
    LANDING_MAX_DIST: 10
};

const TECH_DATA = {
    infantry: [
        { id: "inf1", name: "基本歩兵装備", cost: 100, req: [], x: 20, y: 50, desc: "歩兵の基礎攻撃力+10%", effect: { type: "atk_mult", val: 1.1 } },
        { id: "inf2", name: "支援火器I", cost: 200, req: ["inf1"], x: 180, y: 50, desc: "歩兵の防御力+15%", effect: { type: "def_mult", val: 1.15 } },
        { id: "inf3", name: "改良型歩兵装備", cost: 400, req: ["inf2"], x: 340, y: 50, desc: "歩兵の攻撃力さらに+20%", effect: { type: "atk_mult", val: 1.2 } }
    ],
    industry: [
        { id: "ind1", name: "基礎工作機械", cost: 100, req: [], x: 20, y: 50, desc: "プロヴィンスからの基礎IC算出+10%", effect: { type: "ic_mult", val: 1.1 } },
        { id: "ind2", name: "分散工業I", cost: 300, req: ["ind1"], x: 180, y: 0, desc: "基礎IC算出+20%", effect: { type: "ic_mult", val: 1.2 } }
    ],
    doctrine: [
        { id: "doc1", name: "機動戦ドクトリン", cost: 300, req: [], x: 20, y: 50, desc: "自動攻勢時の移動速度・突破力増加", effect: { type: "speed", val: 1.5 } }
    ],
    navy: [
        { id: "nav1", name: "上陸用舟艇", cost: 200, req: [], x: 20, y: 50, desc: "海外への上陸作戦が可能になる", effect: { type: "can_land", val: true } },
        { id: "nav2", name: "改良型上陸用舟艇", cost: 400, req: ["nav1"], x: 180, y: 50, desc: "上陸時の攻撃ペナルティを軽減", effect: { type: "landing_atk_mult", val: 2.0 } }
    ]
};

class GameEngine {
    constructor() {
        this.mapMeta = { width: 0, height: 0 };
        this.tiles = []; 
        this.countries = {}; 
        
        this.playerId = null;
        this.player = null;
        
        this.tickCount = 0;
        this.gameLoopId = null;
        this.isPaused = true;
        this.isReady = false;

        this.speedLevel = 3;
        this.tickMs = CONFIG.SPEED_MS[this.speedLevel];
        
        this.autoRecruit = true;
    }

    async loadMap(jsonData) {
        const rawMap = jsonData.map;
        this.mapMeta = jsonData.meta;
        this.tiles = [];
        this.countries = {};
        let colorIdx = 1;

        if (jsonData.countries) {
            for (const [idStr, info] of Object.entries(jsonData.countries)) {
                const id = parseInt(idStr);
                this.initCountry(id, info.name, CONFIG.COLORS[colorIdx % CONFIG.COLORS.length]);
                colorIdx++;
            }
        }

        for (let y = 0; y < this.mapMeta.height; y++) {
            let row = [];
            for (let x = 0; x < this.mapMeta.width; x++) {
                const ownerId = rawMap[y][x];
                
                if (ownerId !== CONFIG.SEA_ID && !this.countries[ownerId]) {
                    this.initCountry(ownerId, `未確認国家 ${ownerId}`, CONFIG.COLORS[colorIdx % CONFIG.COLORS.length]);
                    colorIdx++;
                }

                const isLand = ownerId !== CONFIG.SEA_ID;
                const baseIc = isLand ? Math.floor(Math.random() * 3) + 1 : 0;
                const baseMp = isLand ? Math.floor(Math.random() * 50) + 10 : 0;
                const unitCount = isLand && Math.random() < 0.1 ? 1 : 0;
                
                // unitsをオブジェクトに変更。初期化時はすべて歩兵とする
                const units = { infantry: unitCount, cavalry: 0, spearmen: 0, archers: 0 };

                row.push({ x, y, owner: ownerId, baseIc, baseMp, units, fort: 0 });

                if (isLand && unitCount > 0) {
                    this.countries[ownerId].totalDivisions += unitCount;
                }
            }
            this.tiles.push(row);
        }

        ui.buildSetupScreen(this.countries);
        ui.log("システム", "マップをロード完了。", "text-green");
    }

    getTotalUnits(tile) {
        if (!tile || !tile.units) return 0;
        return Object.values(tile.units).reduce((a, b) => a + b, 0);
    }

    initCountry(id, name, color) {
        this.countries[id] = {
            id, name, color,
            ic: 100, manpower: 50000, 
            reserveDivisions: 0, 
            totalDivisions: 0,   
            techs: [], techMods: { atk_mult: 1.0, def_mult: 1.0, ic_mult: 1.0, speed: 1.0, can_land: false, landing_atk_mult: 0.4 },
            armies: []
        };
    }

    isCoastal(x, y) {
        if (this.tiles[y][x].owner === CONFIG.SEA_ID) return false;
        return this.getNeighbors(x, y).some(n => n.owner === CONFIG.SEA_ID);
    }

    startGame(countryId) {
        this.playerId = countryId;
        this.player = this.countries[countryId];
        this.isReady = true;
        
        document.getElementById('setup-screen').style.display = 'none';
        document.getElementById('ui-country-name').innerText = `♚ ${this.player.name}`;
        
        ui.initCanvas();
        ui.log("司令部", `${this.player.name} の指揮を引き継ぎました。`, "text-green");

        ui.updateTopBar();
        ui.renderMap();
    }

    changeSpeed(level) {
        this.speedLevel = parseInt(level);
        this.tickMs = CONFIG.SPEED_MS[this.speedLevel];
        document.getElementById('speed-display').innerText = this.speedLevel;
        if (!this.isPaused && this.gameLoopId) {
            clearInterval(this.gameLoopId);
            this.gameLoopId = setInterval(() => this.tick(), this.tickMs);
        }
    }

    togglePause() {
        if (!this.isReady) return;
        this.isPaused = !this.isPaused;
        const btn = document.getElementById('btn-pause');
        btn.innerText = this.isPaused ? "▶️ 再開" : "⏸️ 停止";
        if (this.isPaused) {
            btn.classList.add("primary");
            clearInterval(this.gameLoopId);
            this.gameLoopId = null;
        } else {
            btn.classList.remove("primary");
            this.gameLoopId = setInterval(() => this.tick(), this.tickMs);
        }
    }

    toggleAutoRecruit() {
        this.autoRecruit = !this.autoRecruit;
        const btn = document.getElementById('btn-auto-recruit');
        btn.innerText = `⚔️ 自動徴兵: ${this.autoRecruit ? 'ON' : 'OFF'}`;
        if (this.autoRecruit) {
            btn.classList.add('gold');
            btn.classList.remove('primary');
        } else {
            btn.classList.remove('gold');
            btn.classList.add('primary');
        }
    }

    tick() {
        this.tickCount++;
        if (this.tickCount % ((24 / CONFIG.HOURS_PER_TICK) * CONFIG.DAYS_PER_MONTH) === 0) {
            this.processMonthly();
        }
        this.processArmies();
        ui.updateTopBar();
        ui.renderMap(); 
    }

    processMonthly() {
        for (const cId in this.countries) {
            const c = this.countries[cId];
            let monthlyIc = 0; let monthlyMp = 0;

            for (let y = 0; y < this.mapMeta.height; y++) {
                for (let x = 0; x < this.mapMeta.width; x++) {
                    if (this.tiles[y][x].owner === c.id) {
                        monthlyIc += this.tiles[y][x].baseIc;
                        monthlyMp += this.tiles[y][x].baseMp;
                    }
                }
            }
            c.ic += Math.floor(monthlyIc * c.techMods.ic_mult); 
            c.manpower += monthlyMp;

            const shouldRecruit = (c.id !== this.playerId) || (c.id === this.playerId && this.autoRecruit);
            if (shouldRecruit) {
                while (c.ic >= CONFIG.COST_DIVISION_IC && c.manpower >= CONFIG.COST_DIVISION_MP) {
                    c.ic -= CONFIG.COST_DIVISION_IC;
                    c.manpower -= CONFIG.COST_DIVISION_MP;
                    c.reserveDivisions++;
                    c.totalDivisions++;
                }
            }
        }
    }

    createArmyGroup() {
        const armyId = this.player.armies.length + 1;
        this.player.armies.push({
            name: `第${armyId}軍団`,
            reserveDivisions: 0, 
            unitType: 'infantry',
            frontline: new Set(),
            targetline: new Set(),
            targetCountryId: null,
            isActive: false
        });
        ui.updateArmyPanel();
    }

    // 軍団の解体機能
    disbandArmy(index) {
        if (!this.player || !this.player.armies[index]) return;
        const army = this.player.armies[index];
        
        // 待機中の予備師団を国家プールへ返還
        this.player.reserveDivisions += army.reserveDivisions;
        
        // 軍団の削除
        this.player.armies.splice(index, 1);
        
        // 描画モード中の軍団だった場合は解除
        if (ui.activeArmyIndex === index) {
            ui.cancelDrawingMode();
        } else if (ui.activeArmyIndex > index) {
            ui.activeArmyIndex--; 
        }
        
        ui.log("司令部", `${army.name} を解体しました。`, "text-muted");
        ui.updateArmyPanel();
        ui.updateTopBar();
        ui.renderMap();
    }

    // 作戦（ライン）の取り消し機能
    clearArmyLines(index) {
        if (!this.player || !this.player.armies[index]) return;
        const army = this.player.armies[index];
        army.frontline.clear();
        army.targetline.clear();
        army.isActive = false;
        ui.log("司令部", `${army.name} の作戦計画を白紙撤回しました。`);
        ui.updateArmyPanel();
        ui.renderMap();
    }

    assignDivisionToArmy(armyIndex) {
        const army = this.player.armies[armyIndex];
        if (this.player.reserveDivisions > 0) {
            this.player.reserveDivisions--;
            army.reserveDivisions++;
            ui.updateArmyPanel();
            ui.updateTopBar();
        } else {
            ui.log("警告", "予備プールに師団がいません。", "text-red");
        }
    }

    toggleArmyActive(index) {
        const army = this.player.armies[index];
        if (army.isActive) {
            army.isActive = false;
            ui.log("報告", `${army.name} に待機命令を下しました。`);
        } else {
            if (army.frontline.size === 0 || army.targetline.size === 0) {
                ui.log("警告", "前線と攻勢線の両方を設定してください。", "text-red");
                return;
            }
            army.isActive = true;
            ui.log("作戦", `${army.name} が面での攻勢作戦を開始しました！`, "text-gold");
        }
        ui.updateArmyPanel();
    }

    processArmies() {
        for (const army of this.player.armies) {
            if (army.frontline.size > 0 && army.reserveDivisions > 0 && this.tickCount % 5 === 0) {
                const frontTiles = Array.from(army.frontline).map(c => {
                    const [x,y] = c.split(',').map(Number); return this.tiles[y][x];
                }).filter(t => t.owner === this.player.id);
                
                if (frontTiles.length > 0) {
                    frontTiles.sort((a,b) => this.getTotalUnits(a) - this.getTotalUnits(b));
                    frontTiles[0].units[army.unitType || 'infantry']++;
                    army.reserveDivisions--;
                    ui.updateArmyPanel();
                }
            }

            if (!army.isActive) continue;

            if (this.tickCount % 8 === 0) {
                this.executeOffensive(this.player, army);
            }
        }

        if (this.tickCount % 12 === 0) {
            this.processAI();
        }
    }

    executeOffensive(attackerObj, army) {
        if (army.frontline.size === 0 || army.targetline.size === 0) return;

        this.updateFrontline(army, attackerObj.id);

        army.frontline.forEach(coordStr => {
            const [fx, fy] = coordStr.split(',').map(Number);
            const fromTile = this.tiles[fy][fx];
            
            if (fromTile.owner !== attackerObj.id || this.getTotalUnits(fromTile) <= 0) return;

            let neighbors = this.getNeighbors(fx, fy).filter(n => n.owner !== CONFIG.SEA_ID && n.owner !== attackerObj.id);
            let isLanding = false;

            if (neighbors.length === 0 && attackerObj.techMods.can_land && this.isCoastal(fx, fy)) {
                const landingTargets = [];
                army.targetline.forEach(tCoord => {
                    const [tx, ty] = tCoord.split(',').map(Number);
                    if (this.isCoastal(tx, ty) && this.tiles[ty][tx].owner !== attackerObj.id) {
                        const dist = Math.hypot(fx - tx, fy - ty);
                        if (dist < CONFIG.LANDING_MAX_DIST) landingTargets.push(this.tiles[ty][tx]);
                    }
                });
                if (landingTargets.length > 0) {
                    neighbors = landingTargets;
                    isLanding = true;
                }
            }

            if (neighbors.length === 0) return;

            neighbors.sort((a, b) => this.getMinDistanceToTargetLine(a, army.targetline) - this.getMinDistanceToTargetLine(b, army.targetline));
            const targetTile = neighbors[0];

            if (Math.random() < 0.4) {
                this.resolveCombat(fromTile, targetTile, attackerObj, this.countries[targetTile.owner], army, isLanding);
            }
        });
        ui.updateArmyPanel();
    }

    processAI() {
        for (const cId in this.countries) {
            const ai = this.countries[cId];
            if (ai.id === this.playerId) continue;

            if (ai.reserveDivisions > 0) {
                const borderTiles = [];
                for(let y=0; y<this.mapMeta.height; y++){
                    for(let x=0; x<this.mapMeta.width; x++){
                        const t = this.tiles[y][x];
                        if(t.owner === ai.id) {
                            const hasEnemy = this.getNeighbors(x,y).some(n => n.owner !== ai.id && n.owner !== CONFIG.SEA_ID);
                            if (hasEnemy) borderTiles.push(t);
                        }
                    }
                }
                if (borderTiles.length > 0) {
                    borderTiles.sort((a,b) => this.getTotalUnits(a) - this.getTotalUnits(b));
                    borderTiles[0].units.infantry++;
                    ai.reserveDivisions--;
                }
            }

            const borderUnits = [];
            for (let y = 0; y < this.mapMeta.height; y++) {
                for (let x = 0; x < this.mapMeta.width; x++) {
                    const t = this.tiles[y][x];
                    if (t.owner === ai.id && this.getTotalUnits(t) > 0) borderUnits.push(t);
                }
            }

            borderUnits.forEach(fromTile => {
                const neighbors = this.getNeighbors(fromTile.x, fromTile.y).filter(n => n.owner !== ai.id && n.owner !== CONFIG.SEA_ID);
                if (neighbors.length > 0 && Math.random() < 0.25) { 
                    const targetTile = neighbors[Math.floor(Math.random() * neighbors.length)];
                    this.resolveCombat(fromTile, targetTile, ai, this.countries[targetTile.owner], null);
                }
            });
        }
    }

    getMinDistanceToTargetLine(tile, targetlineSet) {
        let minDist = Infinity;
        targetlineSet.forEach(coordStr => {
            const [tx, ty] = coordStr.split(',').map(Number);
            const dist = Math.hypot(tile.x - tx, tile.y - ty);
            if (dist < minDist) minDist = dist;
        });
        return minDist;
    }

    calculatePower(tile, isAttacker, techMods, opponentUnits = null) {
        let power = 0;
        for (const type in tile.units) {
            const count = tile.units[type];
            if (count <= 0) continue;

            const basePower = isAttacker ? UNIT_TYPES[type].atk : UNIT_TYPES[type].def;
            let typePower = count * basePower * 3;

            // 相性ボーナス
            if (opponentUnits) {
                const bonusTarget = UNIT_TYPES[type].bonusAgainst;
                if (bonusTarget && opponentUnits[bonusTarget] > 0) {
                    // 敵軍に得意な兵種がいれば、その割合に応じてボーナス（最大+50%）
                    const opponentTotal = Object.values(opponentUnits).reduce((a, b) => a + b, 0);
                    if (opponentTotal > 0) {
                        const ratio = opponentUnits[bonusTarget] / opponentTotal;
                        typePower *= (1.0 + 0.5 * ratio);
                    }
                }
            }
            power += typePower;
        }

        const mult = isAttacker ? (techMods.atk_mult || 1.0) : (techMods.def_mult || 1.0);
        return (Math.random() * 5 + power) * mult;
    }

    resolveCombat(fromTile, toTile, attacker, defender, armyObj = null, isLanding = false) {
        let atkScore = this.calculatePower(fromTile, true, attacker.techMods, toTile.units);
        if (isLanding) atkScore *= attacker.techMods.landing_atk_mult;
        
        const defScore = this.calculatePower(toTile, false, defender ? defender.techMods : { def_mult: 1.0 }, fromTile.units) + (toTile.fort * 2);

        if (atkScore > defScore) {
            // 全兵種を比例的に移動
            const fromTotal = this.getTotalUnits(fromTile);
            const moveRatio = 0.5;
            
            if (toTile.units && defender) {
                const toTotal = this.getTotalUnits(toTile);
                defender.totalDivisions = Math.max(0, defender.totalDivisions - toTotal);
            }
            
            toTile.owner = attacker.id;
            for (const type in fromTile.units) {
                const moving = Math.ceil(fromTile.units[type] * moveRatio);
                fromTile.units[type] -= moving;
                toTile.units[type] = moving;
            }

            if (armyObj) {
                armyObj.frontline.add(`${toTile.x},${toTile.y}`);
                armyObj.targetline.delete(`${toTile.x},${toTile.y}`);

                if (attacker.id === this.playerId && Math.random() < 0.1) {
                    ui.log("戦果", `前進に成功。(${toTile.x}, ${toTile.y}) 制圧`, "text-blue");
                }
            }
        } else {
            // 全兵種を比例的に損失
            const fromTotal = this.getTotalUnits(fromTile);
            if (Math.random() < 0.2 && fromTotal > 1) {
                // ランダムに1つ損失
                const types = Object.keys(fromTile.units).filter(t => fromTile.units[t] > 0);
                const lostType = types[Math.floor(Math.random() * types.length)];
                fromTile.units[lostType]--;
                attacker.totalDivisions = Math.max(0, attacker.totalDivisions - 1);
            }
        }
    }

    updateFrontline(army, ownerId) {
        const newFrontline = new Set();
        
        army.frontline.forEach(coordStr => {
            const [x, y] = coordStr.split(',').map(Number);
            const tile = this.tiles[y][x];
            
            if (tile.owner === ownerId) {
                const hasEnemy = this.getNeighbors(x,y).some(n => n.owner !== ownerId && n.owner !== CONFIG.SEA_ID);
                
                let canLaunchLanding = false;
                if (!hasEnemy && this.countries[ownerId].techMods.can_land && this.isCoastal(x, y)) {
                    army.targetline.forEach(tCoord => {
                        const [tx, ty] = tCoord.split(',').map(Number);
                        if (this.isCoastal(tx, ty) && this.tiles[ty][tx].owner !== ownerId) {
                            if (Math.hypot(x - tx, y - ty) < CONFIG.LANDING_MAX_DIST) canLaunchLanding = true;
                        }
                    });
                }

                if (hasEnemy || canLaunchLanding) {
                    newFrontline.add(coordStr);
                } else if (this.getTotalUnits(tile) > 0) {
                    this.moveUnitsToNearestFront(tile, army, ownerId);
                }
            }
        });

        army.frontline = newFrontline;
    }

    moveUnitsToNearestFront(tile, army, ownerId) {
        if (this.getTotalUnits(tile) <= 0) return;
        
        const borderTiles = [];
        for(let y=0; y<this.mapMeta.height; y++){
            for(let x=0; x<this.mapMeta.width; x++){
                const t = this.tiles[y][x];
                if(t.owner === ownerId) {
                    const hasEnemy = this.getNeighbors(x,y).some(n => n.owner !== ownerId && n.owner !== CONFIG.SEA_ID);
                    if (hasEnemy) borderTiles.push(t);
                }
            }
        }
        
        if (borderTiles.length > 0) {
            borderTiles.sort((a,b) => Math.hypot(a.x - tile.x, a.y - tile.y) - Math.hypot(b.x - tile.x, b.y - tile.y));
            for (const type in tile.units) {
                borderTiles[0].units[type] += tile.units[type];
                tile.units[type] = 0;
            }
            army.frontline.add(`${borderTiles[0].x},${borderTiles[0].y}`); 
        }
    }

    getNeighbors(x, y) {
        const n = [];
        if (x > 0) n.push(this.tiles[y][x-1]);
        if (x < this.mapMeta.width - 1) n.push(this.tiles[y][x+1]);
        if (y > 0) n.push(this.tiles[y-1][x]);
        if (y < this.mapMeta.height - 1) n.push(this.tiles[y+1][x]);
        return n;
    }

    research(techId, category) {
        const tech = TECH_DATA[category].find(t => t.id === techId);
        if (!tech || this.player.techs.includes(techId)) return;
        if (this.player.ic < tech.cost) return ui.log("警告", "研究用ICが不足しています。", "text-red");
        
        this.player.ic -= tech.cost;
        this.player.techs.push(techId);
        if (tech.effect) {
            const type = tech.effect.type;
            const val = tech.effect.val;
            if (typeof val === 'number') {
                this.player.techMods[type] = (this.player.techMods[type] || 1.0) * val;
            } else {
                this.player.techMods[type] = val;
            }
        }
        
        ui.log("研究", `「${tech.name}」開発完了！`, "text-blue");
        ui.updateTopBar();
        ui.renderTechTree(category);
    }
}

const game = new GameEngine();

const ui = {
    canvas: null,
    ctx: null,
    currentTechTab: 'infantry',
    camera: { zoom: 1.0 },
    
    drawingMode: 'none', 
    activeArmyIndex: null,
    isPainting: false,

    initialPinchDistance: null,
    lastInputX: null,
    lastInputY: null,
    isDraggingCamera: false,

    initCanvas() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        this.canvas.width = game.mapMeta.width * CONFIG.TILE_SIZE;
        this.canvas.height = game.mapMeta.height * CONFIG.TILE_SIZE;

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            this.handleInputStart(e.clientX, e.clientY);
        });
        this.canvas.addEventListener('mousemove', (e) => this.handleInputMove(e.clientX, e.clientY));
        this.canvas.addEventListener('mouseup', (e) => { if (e.button === 0) this.handleInputEnd(); });
        this.canvas.addEventListener('mouseleave', () => this.handleInputEnd());
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomAmount = e.deltaY > 0 ? 0.9 : 1.1;
            this.applyZoom(zoomAmount);
        });
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.cancelDrawingMode();
        });

        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault(); 
            if (e.touches.length === 1) {
                this.handleInputStart(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2) {
                this.isPainting = false;
                this.isDraggingCamera = false;
                this.initialPinchDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
            }
        });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
                this.handleInputMove(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2 && this.initialPinchDistance) {
                const currentDistance = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                const zoomFactor = currentDistance / this.initialPinchDistance;
                if (zoomFactor > 1.05) {
                    this.applyZoom(1.05);
                    this.initialPinchDistance = currentDistance;
                } else if (zoomFactor < 0.95) {
                    this.applyZoom(0.95);
                    this.initialPinchDistance = currentDistance;
                }
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            if (e.touches.length < 2) this.initialPinchDistance = null;
            if (e.touches.length === 0) this.handleInputEnd();
        });
    },

    cancelDrawingMode() {
        if(this.drawingMode === 'none') return;
        this.drawingMode = 'none';
        this.activeArmyIndex = null;
        this.isPainting = false;
        document.getElementById('operation-banner').style.display = 'none';
        this.updateArmyPanel();
    },

    setDrawingMode(mode, armyIndex) {
        if (this.drawingMode === mode && this.activeArmyIndex === armyIndex) {
            this.cancelDrawingMode();
            return;
        }

        this.drawingMode = mode;
        this.activeArmyIndex = armyIndex;
        
        const banner = document.getElementById('operation-banner');
        banner.style.display = 'block';
        banner.className = '';
        
        if (mode === 'frontline') {
            banner.innerText = "📍 前線をなぞる（タップで解除）";
            banner.classList.add('mode-frontline');
        } else if (mode === 'targetline') {
            banner.innerText = "🚩 攻勢線をなぞる（タップで解除）";
            banner.classList.add('mode-targetline');
        }
        this.updateArmyPanel();
    },

    applyZoom(amount) {
        this.camera.zoom = Math.max(0.5, Math.min(this.camera.zoom * amount, 3.0)); 
        this.canvas.style.transform = `scale(${this.camera.zoom})`;
    },

    getMapCoordinates(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((clientX - rect.left) / (CONFIG.TILE_SIZE * this.camera.zoom));
        const y = Math.floor((clientY - rect.top) / (CONFIG.TILE_SIZE * this.camera.zoom));
        return {x, y};
    },

    handleInputStart(clientX, clientY) {
        this.lastInputX = clientX;
        this.lastInputY = clientY;

        if (this.drawingMode !== 'none') {
            this.isPainting = true;
            this.paintTile(clientX, clientY);
        } else {
            this.isDraggingCamera = true;
        }
        this.updateTileInfo(clientX, clientY);
    },

    handleInputMove(clientX, clientY) {
        if (this.isDraggingCamera && this.drawingMode === 'none') {
            const container = document.getElementById('map-container');
            container.scrollLeft -= (clientX - this.lastInputX);
            container.scrollTop -= (clientY - this.lastInputY);
            this.lastInputX = clientX;
            this.lastInputY = clientY;
        }

        if (this.isPainting && this.drawingMode !== 'none') {
            this.paintTile(clientX, clientY);
        }

        this.updateTileInfo(clientX, clientY);
    },

    handleInputEnd() {
        this.isPainting = false;
        this.isDraggingCamera = false;
        this.initialPinchDistance = null;
    },

    updateTileInfo(clientX, clientY) {
        const pos = this.getMapCoordinates(clientX, clientY);
        if (pos.x >= 0 && pos.x < game.mapMeta.width && pos.y >= 0 && pos.y < game.mapMeta.height) {
            const tile = game.tiles[pos.y][pos.x];
            const ownerObj = game.countries[tile.owner];
            
            document.getElementById('ti-placeholder').style.display = 'none';
            document.getElementById('tile-info-content').style.display = 'block';
            document.getElementById('ti-coords').innerText = `(${pos.x}, ${pos.y})`;
            document.getElementById('ti-owner').innerText = tile.owner === CONFIG.SEA_ID ? "海洋" : (ownerObj ? ownerObj.name : "未知");
            document.getElementById('ti-owner').style.color = tile.owner === CONFIG.SEA_ID ? "#00bcd4" : (ownerObj ? ownerObj.color : "#fff");
            document.getElementById('ti-ic').innerText = tile.baseIc;
            document.getElementById('ti-manpower').innerText = tile.baseMp;
            
            const totalUnits = game.getTotalUnits(tile);
            let unitsText = totalUnits > 0 ? `${totalUnits} 個` : "なし";
            if (totalUnits > 0) {
                const breakdown = Object.entries(tile.units)
                    .filter(([type, count]) => count > 0)
                    .map(([type, count]) => `${UNIT_TYPES[type].icon}${count}`)
                    .join(' ');
                unitsText += ` (${breakdown})`;
            }
            document.getElementById('ti-units').innerText = unitsText;

            if (this.drawingMode === 'frontline') {
                this.canvas.style.cursor = tile.owner === game.player.id ? 'cell' : 'not-allowed';
            } else if (this.drawingMode === 'targetline') {
                this.canvas.style.cursor = (tile.owner !== CONFIG.SEA_ID && tile.owner !== game.player.id) ? 'crosshair' : 'not-allowed';
            } else {
                this.canvas.style.cursor = 'grab';
            }
        }
    },

    paintTile(clientX, clientY) {
        const pos = this.getMapCoordinates(clientX, clientY);
        if (pos.x < 0 || pos.x >= game.mapMeta.width || pos.y < 0 || pos.y >= game.mapMeta.height) return;
        
        const tile = game.tiles[pos.y][pos.x];
        const army = game.player.armies[this.activeArmyIndex];
        const coord = `${pos.x},${pos.y}`;

        if (this.drawingMode === 'frontline') {
            if (tile.owner === game.player.id) {
                army.frontline.add(coord);
                this.renderMap();
            }
        } else if (this.drawingMode === 'targetline') {
            if (tile.owner !== game.player.id && tile.owner !== CONFIG.SEA_ID) {
                army.targetline.add(coord);
                army.targetCountryId = tile.owner; 
                this.renderMap();
            }
        }
    },

    drawArrow(ctx, fromX, fromY, toX, toY) {
        const headlen = 15; 
        const dx = toX - fromX;
        const dy = toY - fromY;
        const angle = Math.atan2(dy, dx);

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
        ctx.lineTo(toX, toY);
        ctx.fill();
    },

    renderMap() {
        if (!this.ctx) return;
        const ts = CONFIG.TILE_SIZE;
        const width = game.mapMeta.width;
        const height = game.mapMeta.height;

        this.ctx.fillStyle = '#0a192f';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const tile = game.tiles[y][x];
                if (tile.owner === CONFIG.SEA_ID) continue; 
                
                const cObj = game.countries[tile.owner];
                this.ctx.fillStyle = cObj ? cObj.color : '#555';
                this.ctx.fillRect(x * ts, y * ts, ts, ts);

                const totalUnits = game.getTotalUnits(tile);
                if (totalUnits > 0) {
                    this.ctx.fillStyle = tile.owner === game.player?.id ? '#4caf50' : '#f44336';
                    this.ctx.fillRect(x * ts + 2, y * ts + 2, ts - 4, ts - 4);
                    this.ctx.fillStyle = '#fff';
                    this.ctx.font = "10px sans-serif";
                    this.ctx.textAlign = "center";
                    this.ctx.textBaseline = "middle";
                    this.ctx.fillText(totalUnits, x * ts + ts / 2, y * ts + ts / 2);
                }
            }
        }

        this.ctx.lineWidth = 1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const tile = game.tiles[y][x];
                const px = x * ts; const py = y * ts;

                if (x < width - 1) {
                    const rightTile = game.tiles[y][x+1];
                    if (tile.owner !== rightTile.owner) { this.ctx.strokeStyle = '#000'; this.ctx.lineWidth = 2; } 
                    else if (tile.owner !== CONFIG.SEA_ID) { this.ctx.strokeStyle = 'rgba(255,255,255,0.1)'; this.ctx.lineWidth = 1; } 
                    else { this.ctx.strokeStyle = 'transparent'; }
                    this.ctx.beginPath(); this.ctx.moveTo(px + ts, py); this.ctx.lineTo(px + ts, py + ts); this.ctx.stroke();
                }

                if (y < height - 1) {
                    const bottomTile = game.tiles[y+1][x];
                    if (tile.owner !== bottomTile.owner) { this.ctx.strokeStyle = '#000'; this.ctx.lineWidth = 2; } 
                    else if (tile.owner !== CONFIG.SEA_ID) { this.ctx.strokeStyle = 'rgba(255,255,255,0.1)'; this.ctx.lineWidth = 1; } 
                    else { this.ctx.strokeStyle = 'transparent'; }
                    this.ctx.beginPath(); this.ctx.moveTo(px, py + ts); this.ctx.lineTo(px + ts, py + ts); this.ctx.stroke();
                }
            }
        }

        if (game.player) {
            game.player.armies.forEach((army, index) => {
                const isSelected = (this.activeArmyIndex === index);
                
                this.ctx.fillStyle = isSelected ? 'rgba(76, 175, 80, 0.6)' : 'rgba(76, 175, 80, 0.2)';
                let fxSum = 0, fySum = 0;
                army.frontline.forEach(coord => {
                    const [x, y] = coord.split(',').map(Number);
                    this.ctx.fillRect(x * ts, y * ts, ts, ts);
                    fxSum += x * ts + ts/2; fySum += y * ts + ts/2;
                });

                this.ctx.fillStyle = isSelected ? 'rgba(244, 67, 54, 0.6)' : 'rgba(244, 67, 54, 0.2)';
                let txSum = 0, tySum = 0;
                army.targetline.forEach(coord => {
                    const [x, y] = coord.split(',').map(Number);
                    this.ctx.fillRect(x * ts, y * ts, ts, ts);
                    txSum += x * ts + ts/2; tySum += y * ts + ts/2;
                });

                if (army.frontline.size > 0 && army.targetline.size > 0) {
                    const fx = fxSum / army.frontline.size;
                    const fy = fySum / army.frontline.size;
                    const tx = txSum / army.targetline.size;
                    const ty = tySum / army.targetline.size;

                    this.ctx.strokeStyle = isSelected ? 'rgba(255, 193, 7, 0.8)' : 'rgba(255, 255, 255, 0.3)';
                    this.ctx.fillStyle = this.ctx.strokeStyle;
                    this.ctx.lineWidth = 4;
                    this.ctx.setLineDash([10, 8]);
                    this.drawArrow(this.ctx, fx, fy, tx, ty);
                    this.ctx.setLineDash([]);
                }
            });
        }
    },

    updateTopBar() {
        if (!game.player) return;
        
        const totalHours = game.tickCount * CONFIG.HOURS_PER_TICK;
        const days = Math.floor(totalHours / 24);
        const y = CONFIG.BASE_YEAR + Math.floor(days / 360);
        const m = Math.floor((days % 360) / 30) + 1;
        const d = (days % 30) + 1;
        
        document.getElementById('top-date').innerText = `${y}年 ${m}月 ${d}日`;
        document.getElementById('top-ic').innerText = game.player.ic;
        document.getElementById('top-manpower').innerText = game.player.manpower;
        
        document.getElementById('top-reserve-divisions').innerText = game.player.reserveDivisions;
        document.getElementById('top-total-divisions').innerText = game.player.totalDivisions;
    },

    // 新レイアウトの軍団パネル更新処理
    updateArmyPanel() {
        const container = document.getElementById('army-list-container');
        container.innerHTML = '';

        if (!game.player) return;

        game.player.armies.forEach((army, index) => {
            const div = document.createElement('div');
            div.className = `army-control ${this.activeArmyIndex === index ? 'active-draw' : ''}`;

            const statusClass = army.isActive ? 'status-offensive' : 'status-idle';
            const statusText = army.isActive ? '進行中' : '待機';

            let frontUnits = 0;
            army.frontline.forEach(c => {
                const [x,y] = c.split(',').map(Number);
                if (game.tiles[y] && game.tiles[y][x] && game.tiles[y][x].owner === game.player.id) {
                    frontUnits += game.getTotalUnits(game.tiles[y][x]);
                }
            });

            const isFrontlineActive = this.drawingMode === 'frontline' && this.activeArmyIndex === index;
            const isTargetlineActive = this.drawingMode === 'targetline' && this.activeArmyIndex === index;

            // 兵種選択肢の生成
            let typeOptions = '';
            for (const type in UNIT_TYPES) {
                const selected = army.unitType === type ? 'selected' : '';
                typeOptions += `<option value="${type}" ${selected}>${UNIT_TYPES[type].icon} ${UNIT_TYPES[type].name}</option>`;
            }

            const currentUnit = UNIT_TYPES[army.unitType || 'infantry'];

            div.innerHTML = `
                <div class="army-header">
                    <strong style="font-size:1.1em;">${army.name}</strong>
                    <div style="display:flex; align-items:center; gap: 8px;">
                        <span class="army-status ${statusClass}">${statusText}</span>
                        <button class="danger" style="padding: 2px 8px; font-size: 0.9em;" onclick="game.disbandArmy(${index})" title="軍団を解体">🗑️</button>
                    </div>
                </div>
                
                <div style="margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.8em; color: var(--text-muted);">兵種:</span>
                    <select onchange="game.player.armies[${index}].unitType = this.value; ui.updateArmyPanel();" 
                            style="background: #333; color: #fff; border: 1px solid #555; border-radius: 4px; padding: 2px 5px; flex: 1; font-size: 0.9em;">
                        ${typeOptions}
                    </select>
                </div>
                <div style="font-size: 0.75em; color: var(--text-muted); margin-bottom: 10px; background: rgba(0,0,0,0.2); padding: 5px; border-radius: 4px;">
                    ${currentUnit.desc} <br>
                    <span class="text-blue">攻: ${currentUnit.atk}</span> | <span class="text-green">守: ${currentUnit.def}</span>
                </div>

                <div class="army-stats-row">
                    <div>展開: <span class="text-green" style="font-weight:bold;">${frontUnits}</span> | 待機: <span class="text-gold" style="font-weight:bold;">${army.reserveDivisions}</span></div>
                    <button class="primary" style="padding: 3px 12px; font-weight:bold;" onclick="game.assignDivisionToArmy(${index})">＋ 補充</button>
                </div>
                
                <div class="army-actions-grid">
                    <button onclick="ui.setDrawingMode('frontline', ${index})" class="${isFrontlineActive ? 'primary' : ''}">📍 前線</button>
                    <button onclick="ui.setDrawingMode('targetline', ${index})" class="${isTargetlineActive ? 'primary' : ''}">🚩 目標線</button>
                    <button onclick="game.clearArmyLines(${index})" style="background-color: #5d4037; border-color: #4e342e;">❌ 取消</button>
                </div>
                
                <button style="width: 100%; padding: 10px; font-weight: bold;" class="${army.isActive ? 'danger' : 'success'}" onclick="game.toggleArmyActive(${index})">
                    ${army.isActive ? '⏹️ 作戦停止' : '▶️ 作戦発動'}
                </button>
            `;
            container.appendChild(div);
        });
    },

    log(category, message, colorClass = "") {
        const logDiv = document.getElementById('log-panel');
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        const timeStr = document.getElementById('top-date') ? document.getElementById('top-date').innerText || "" : "";
        entry.innerHTML = `<span style="color:#666;">[${timeStr}]</span> <strong style="color:#aaa;">[${category}]</strong> <span class="${colorClass}">${message}</span>`;
        logDiv.appendChild(entry);
        logDiv.scrollTop = logDiv.scrollHeight;
    },

    buildSetupScreen(countries) { 
        const list = document.getElementById('setup-country-list');
        list.innerHTML = '';
        for (const id in countries) {
            const c = countries[id];
            const card = document.createElement('div');
            card.className = 'country-card';
            card.innerHTML = `
                <h2 style="color: ${c.color}; margin-top:0;">${c.name}</h2>
                <div style="color: var(--text-muted); font-size: 0.9em;">初期師団: ${c.totalDivisions} <br>初期IC: ${c.ic}</div>
                <button class="primary" style="width: 100%; margin-top: 10px; padding: 12px; font-size: 1.1em;" onclick="game.startGame(${c.id})">プレイ</button>
            `;
            list.appendChild(card);
        }
    },
    
    openTechTree() { document.getElementById('tech-modal').style.display = 'flex'; this.renderTechTree(this.currentTechTab); },
    closeTechTree() { document.getElementById('tech-modal').style.display = 'none'; },
    switchTechTab(tab) { this.currentTechTab = tab; document.querySelectorAll('.tech-tab').forEach(el => el.classList.remove('active')); event.target.classList.add('active'); this.renderTechTree(tab); },
    renderTechTree(category) { 
        document.getElementById('tech-ic-display').innerText = game.player.ic;
        const container = document.getElementById('tech-nodes-container');
        const svg = document.getElementById('tech-lines');
        container.innerHTML = ''; svg.innerHTML = '';
        const techs = TECH_DATA[category];
        techs.forEach(tech => {
            const node = document.createElement('div');
            node.className = 'tech-node';
            node.style.left = `${tech.x}px`; node.style.top = `${tech.y}px`;
            const isResearched = game.player.techs.includes(tech.id);
            if (isResearched) node.classList.add('researched'); else node.classList.add('available');
            node.innerHTML = `<div class="tech-name" style="font-weight:bold;">${tech.name}</div><div style="font-size: 0.75em; color: #aaa; margin-bottom: 5px;">${tech.desc}</div>
                ${!isResearched ? `<div class="tech-cost">必要IC: ${tech.cost}</div>` : `<div class="text-green" style="font-size:0.8em;">研究済</div>`}`;
            if (!isResearched) node.onclick = () => game.research(tech.id, category);
            container.appendChild(node);
        });
    }
};

document.getElementById('mapUpload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try { game.loadMap(JSON.parse(event.target.result)); } catch (err) { alert("JSONのパースに失敗しました。"); }
    };
    reader.readAsText(file);
});

fetch('map.json').then(res => res.json()).then(json => game.loadMap(json)).catch(err => ui.log("システム", "マップ読込失敗", "text-red"));
