import {libWrapper} from "../shim.js";

const MODULE_ID = "difficultterrain";

export class PlayerData {
    otherPlayerWaypoints = new Map();
    currentDifficultyMultiplier = 1;
    gameSettings;
    lastRegisteredKeyPress = Date.now() - Date.now();
    lastRegisteredMouseWheel = Date.now() - Date.now();
    dragRulerFound = false;
    difficultWaypoints = [];
    lastDestination = {};
    rulerArray;

    constructor(ModuleSettings) {
        this.gameSettings = ModuleSettings;
        this.updateRulerArray();
    }

    updateRulerArray() {
        this.rulerArray = [];
        this.rulerArray.push(canvas.controls.ruler);
        this.gameSettings.extendedRuler.split(",").forEach(value => {
            let lowerCaseStart = value.charAt(0).toLowerCase() + value.slice(1);
            if (!(canvas.controls[value] == null))
                this.rulerArray.push(canvas.controls[value])
            else if (!(canvas.controls[lowerCaseStart] == null))
                this.rulerArray.push(canvas.controls[lowerCaseStart])
        });

        this.dragRulerFound = this.rulerArray.some(value => value.constructor.name === "DragRuler")
        return this;
    }

    registerKeyEvent() {
        const self = this;

        libWrapper.register(MODULE_ID, "KeyboardManager.prototype.getKey",
            function (wrapped, e) {
                if (self.dragRulerFound && e.key === "x") {
                    if (self.difficultWaypoints.length >= canvas.controls.dragRuler.waypoints.length && canvas.controls.dragRuler.waypoints.length > 0)
                        self.difficultWaypoints.pop();
                }
                if (Date.now() - self.lastRegisteredKeyPress < self.gameSettings.interval)
                    return wrapped(e);
                self.lastRegisteredKeyPress = Date.now();


                if (e.key === self.gameSettings.incrementHotkey) {
                    self.setTerrainMultiplier(self.gameSettings.increment)
                    self.updateRuler(e);
                }

                if (e.key === self.gameSettings.decreaseHotkey) {
                    self.setTerrainMultiplier(-self.gameSettings.increment)
                    self.updateRuler(e);
                }

                return wrapped(e);
            }, "WRAPPER");
        return this;
    }

    registerBroadcast() {
        const oldBroadcast = game.user.broadcastActivity;
        const self = this;
        game.user.broadcastActivity = function (activityData) {
            let rulerBroadcasting = Object.keys(activityData).reduce((acc, propertyName) => {
                if (
                    !(activityData[propertyName] == null)
                    &&
                    self.rulerArray.some(value => value.constructor.name.localeCompare(propertyName, undefined, {sensitivity: 'base'}) === 0)
                )
                    acc.push(propertyName)
                return acc;
            }, []);
            rulerBroadcasting.forEach((value) => activityData[value] = Object.assign({
                difficultWaypoints: self.difficultWaypoints,
                currentDifficultyMultiplier: self.currentDifficultyMultiplier
            }, activityData[value]));

            oldBroadcast.apply(this, arguments);
        };
        return this;
    }

    registerReceiveBroadcast() {
        const oldRulerUpdate = this.rulerArray.map(value => canvas.controls["update" + value.constructor.name]);
        const self = this;
        oldRulerUpdate.forEach((value, index) => canvas.controls["update" + self.rulerArray[index].constructor.name] = function (user, ruler) {
            if (ruler == null)
                return value.apply(this, arguments);

            self.otherPlayerWaypoints.set(user.id, new detailedWaypointData(
                //Remove duplicates in waypoints so that they can be compared to segments in terrain-calculation
                ruler.waypoints.reduce((acc, current) => {
                    if (acc.length !== 0 && self.sameDestination(acc[acc.length - 1], current)) {
                        return acc;
                    }

                    acc.push(current);

                    return acc;
                }, []),
                ruler.destination, ruler.difficultWaypoints, ruler.currentDifficultyMultiplier));

            value.apply(this, arguments)
        });
        return this;
    }

    registerLeftClick() {
        const handleLeftClick = () => {
            if (this.rulerArray.every(value => value.waypoints.length === 0)) {
                return;
            }
            let res = this.rulerArray.filter(value => value.waypoints.length > this.difficultWaypoints.length + 1 &&
                !this.sameDestination(this.lastDestination, value.destination));
            if (res.length === 1) {
                this.difficultWaypoints.push(this.currentDifficultyMultiplier);
                this.lastDestination = res[0].destination;
            }

        }
        canvas.app.stage.removeListener('click', handleLeftClick);
        canvas.app.stage.addListener('click', handleLeftClick);

        return this;
    }

    registerRightClick() {
        const handleRightClick = () => {
            if (this.rulerArray.every(value => value.waypoints.length === 0)) {
                this.difficultWaypoints = [];
                this.lastDestination = [];
                return;
            }

            let res = this.rulerArray.filter(value => value.waypoints.length > this.difficultWaypoints.length + 1 && value.constructor.name === 'DragRuler');
            if (res.length === 1) {
                if (this.sameDestination(this.lastDestination, res[0].destination))
                    return;
                this.difficultWaypoints.push(this.currentDifficultyMultiplier);
                this.lastDestination = res[0].destination;
                return;
            }
            this.difficultWaypoints.pop();
        }
        //Using this because pixi right click wont register when dragging a token
        $('body').on('contextmenu', (e) => {
            if (e.target.id === "board")
                handleRightClick();
        });
        return this;
    }

    registerMouseWheel() {
        let self = this;
        libWrapper.register(MODULE_ID, 'PlaceablesLayer.prototype._onMouseWheel', function (wrapped, e) {
            if (!self.rulerArray.some(value => value.waypoints.length > 0))
                return wrapped(e);

            if (Date.now() - self.lastRegisteredMouseWheel < self.gameSettings.interval)
                return;
            self.lastRegisteredMouseWheel = Date.now();
            if (e.deltaY < 0) {
                self.setTerrainMultiplier(self.gameSettings.increment)
                self.updateRuler(e);
            } else {
                self.setTerrainMultiplier(-self.gameSettings.increment)
                self.updateRuler(e);
            }
        }, 'MIXED');

        return this;
    }

    registerRulerClear() {
        const oldRulerClear = this.rulerArray.map(value => value.clear);
        const self = this;
        oldRulerClear.forEach((value, index) => this.rulerArray[index].clear = function () {
            self.difficultWaypoints = [];
            self.lastDestination = {};
            value.apply(this, arguments);
        });
        return this;
    }

    setTerrainMultiplier(amount) {
        if (this.currentDifficultyMultiplier === this.gameSettings.max && amount > 0)
            this.currentDifficultyMultiplier = 1;
        else if (this.currentDifficultyMultiplier === 1 && amount < 0)
            this.currentDifficultyMultiplier = this.gameSettings.max;
        else
            this.currentDifficultyMultiplier = Math.clamped(this.currentDifficultyMultiplier + amount, 1, this.gameSettings.max);
    }


    updateRuler(e) {
        if (this.rulerArray.every(value => value.waypoints.length === 0))
            return;
        let currentRuler = this.rulerArray.find(value => value.waypoints.length > 0)
        let newEvent = {};
        newEvent.data = {
            origin: currentRuler.waypoints[currentRuler.waypoints.length - 1],
            destination: currentRuler.destination,
            originalEvent: e
        };

        let ruler = {
            class: currentRuler.constructor.name,
            name: currentRuler.constructor.name + "." + game.user.id,
            waypoints: currentRuler.waypoints,
            destination: currentRuler.destination,
            speed: currentRuler.tokenSpeed,
            _state: 2
        };
        let activityData = {
            [ruler.class.toLowerCase()]: ruler
        };
        if (game.user.hasPermission("SHOW_RULER"))
            game.user.broadcastActivity(activityData);
        currentRuler._onMouseMove(newEvent);
    }

    sameDestination(old, current) {
        return !(old == null) && !(current == null) && old.x === current.x && old.y === current.y;
    }
}

class detailedWaypointData {
    constructor(wayPoints, endPoint, difficultyMultiplierWayPoints, difficultMultiplierNow) {
        this.wayPoints = wayPoints;
        this.endPoint = endPoint;
        this.difficultyMultiplierWayPoints = difficultyMultiplierWayPoints;
        this.difficultMultiplierNow = difficultMultiplierNow;
    }
}