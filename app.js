'use strict';

const Homey = require('homey');
const http = require('http.min');
class AggregatedInsightsApp extends Homey.App {
	onInit() {
		
		this.log('AggregatedInsightsApp is running...');
		this.timer = null;
		this.calculating = false;
		Homey.ManagerApi.getOwnerApiToken().then(apiToken =>{
			Homey.ManagerSettings.set('apiToken', apiToken);
			this.log('token:',apiToken);
			this.refreshAvailableLogs();
			this.calculateAggregations();
		});
		Homey.ManagerInsights.getLogs().then(logs =>{
			var aggregations = this.getAggregations();
			logs.forEach(log => {
				var logFound = false;
				aggregations.forEach(aggregation =>{
					if(aggregation.name == log.name){
						logFound = true;
					}
				});
				if(!logFound){
					this.log('delete abandoned aggregated log ' + log.name);
					Homey.ManagerInsights.deleteLog(log, function callback(err, logs) {
						if (err) {
							console.error(err);
						}else{
						}
					});
				}
			});
		}).catch();

		
		let calcAction = new Homey.FlowCardAction('calc');
		calcAction.register().registerRunListener(( args, state ) => {
			this.calculateAggregations();
		});
		let recalcAction = new Homey.FlowCardAction('recalcAggregation');
		recalcAction.register().registerRunListener(( args, state ) => {
			this.recalcAggregation(args.name);
		});
		Homey.ManagerSettings.on('set', setting =>{
			if(setting == 'recalcAggregation'){
				this.recalcAggregation(Homey.ManagerSettings.get('recalcAggregation'));			
			}else if(setting == 'addAggregation'){
				this.calculateAggregations();
			}else if(setting == 'deleteAggregation'){
				this.calculateAggregations();
			}
		});
	}

	recalcAggregation(aggregationName){
		var t = this;
		if(this.calculating){
			//try again in 10 seconds
			this.log('retry recalc in 10 seconds');
			setTimeout(function(){t.recalcAggregation(aggregationName);}, 10000);
			return;
		}
		if(this.timer !== null){
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.log('recalc ' +aggregationName);
		var aggregations = this.getAggregations();
		aggregations.forEach((aggregation, aggregationIndex, aggregations) => {
			if(aggregation.name == aggregationName){
				Homey.ManagerInsights.getLog(aggregation.name, function(err, logs) {
					if (err) {
						aggregations[aggregationIndex].next = aggregations[aggregationIndex].start;
						aggregations[aggregationIndex].nextEnd = null;
						Homey.ManagerSettings.set('aggregations', aggregations);
						Homey.ManagerSettings.unset('recalcAggregation');
						t.calculateAggregations();
					}else{
						Homey.ManagerInsights.deleteLog(logs, function callback(err, logs) {
							if (err) {
								console.error(err);
							}else{
								aggregations[aggregationIndex].next = aggregations[aggregationIndex].start;
								aggregations[aggregationIndex].nextEnd = null;
								Homey.ManagerSettings.set('aggregations', aggregations);
								Homey.ManagerSettings.unset('recalcAggregation');
								t.calculateAggregations();
							}
						});
					}
				});
			}
		});
	}


	getToken () {
		return Homey.ManagerSettings.get('apiToken');
	}

	getLogs () {
		return this.api('/manager/insights/log', true);
	}

	getLog(logId,start,end){
		var uri = '/manager/insights/log/'+logId+'/entry';
		if(start){
			uri += '?start='+start.toISOString();
			if(end){
				uri += '&end='+end.toISOString();
			}
		}
		return this.api(uri, false);
	}
	parseLog(data){
		var items = [];
		var lines = data.match(/[^\r\n]+/g);
		if(lines){
			lines.forEach(line => {
				var s = line.split(',');
				if(s.length == 2){
					items.push({date: new Date(s[0]), value: Number(s[1])});
				}
			});
		}
		return items;
	}

	refreshAvailableLogs(){
		this.getLogs().then(logs =>	{
			var logMap = logs.map(log => ({id:log.uri+'/'+log.name,name:(log.uriObj.name?log.uriObj.name:log.uri)+'/'+log.label.en}));
			Homey.ManagerSettings.set('logs', logMap);
			//console.log(logs);
		}).catch(err => {
			console.error(err);
		});
	}
	  

	api(path, json) {
		return this.apiRaw(path, json)
		  .then(result => {
			var data = result.data
			var statusCode = result.response.statusCode
			if (statusCode >= 200 && statusCode < 400) {
			  if(json){
				  return data.result;
			  }else{
				  return data;
			  }
			} else {
			  return Promise.reject((data && data.result) || data)
			}
		  })
	}

	apiRaw(path, json) {
		var bearerToken = this.getToken()
		var options = {
		  uri: `http://127.0.0.1/api${path}`,
		  timeout: 120000,
		  json: json
		}
		if (bearerToken) {
		  options.headers = {
			authorization: `Bearer ${bearerToken}`
		  }
		}
		return http['get'](options)
	  }

	  calculateAggregations(){
		if(this.timer !== null){
			clearTimeout(this.timer);
			this.timer = null;
		}
		if(this.calculating){
			return;
		}
		this.calculating = true;

		var aggregations = this.getAggregations();
		this.log('checking '+aggregations.length+' aggregations for updates');
		Homey.ManagerApi.realtime('aggregateLog', 'checking '+aggregations.length+' aggregations for updates');
		var addAggregation = Homey.ManagerSettings.get('addAggregation');
		if(addAggregation){
			var aggregationIndex = -1;
            aggregations.forEach((a,i) => {
              if(a.name == addAggregation.name){
                aggregationIndex = i;
              }
			});
			if(aggregationIndex == -1){
				aggregations.push(addAggregation);
			}else{
				aggregations[aggregationIndex].label = addAggregation.label;
				aggregations[aggregationIndex].units = addAggregation.units;
				aggregations[aggregationIndex].decimals = addAggregation.decimals;
				addAggregation.logs.forEach(addLog =>{
					var logIndex = -1;
					aggregations[aggregationIndex].logs.forEach((a,i) => {
						if(a.id == addLog.id){
							logIndex = i;
						}
					});
					if(logIndex == -1){
						aggregations[aggregationIndex].logs.push(addLog);
					}else{
						aggregations[aggregationIndex].logs[logIndex] = addLog;
					}
				});
			}
			Homey.ManagerSettings.set('aggregations', aggregations);
			Homey.ManagerSettings.unset('addAggregation');
			this.log('added aggregation '+ addAggregation.name);
			Homey.ManagerApi.realtime('aggregateLog', 'added aggregation '+ addAggregation.name);
		}
		Promise.all(aggregations.map((aggregation, aggregationIndex, aggregations) => {
			if(aggregation.name == Homey.ManagerSettings.get('deleteAggregation')){
				aggregations.splice(aggregationIndex, 1);
				Homey.ManagerSettings.set('aggregations', aggregations);
				Homey.ManagerSettings.unset('deleteAggregation',null);
				this.log('deleted aggregation '+ aggregation.name);
				Homey.ManagerInsights.getLog(aggregation.name, function(err, logs) {
					if (err) {
					}else{
						Homey.ManagerInsights.deleteLog(logs, function callback(err, logs) {
							if (err) {
								console.error(err);
							}else{
							}
						});
					}
				});
				Homey.ManagerApi.realtime('aggregateLog', 'deleted aggregation '+ aggregation.name);
			}else if((!aggregation.next || this.addPeriod(aggregation.next, aggregation.period) < new Date()) && (!aggregation.nextEnd || new Date(aggregation.nextEnd) < new Date())){
				var start;
				if(aggregation.next){
					start = this.getPeriodStart(aggregation.next, aggregation.period);
				}else if(aggregation.next){
					start = this.getPeriodStart(aggregation.start, aggregation.period);
				}else{
					//TODO get start from logs
					start = this.getPeriodStart(new Date(), aggregation.period);
				}
				var end = new Date(this.addPeriod(start, aggregation.period));
				var nextEnd = new Date(this.addPeriodNextLog(end, aggregation.period));
				if(aggregation.nextEnd && new Date(aggregation.nextEnd) > nextEnd){
					nextEnd = new Date(aggregation.nextEnd);
				}
				//this.log("calc "+ aggregation.name +" "+start+" "+end);
				var p = [];
				aggregations[aggregationIndex].logs.forEach((log, logIndex) => {
					p.push({
						promise: this.getLog(log.id,start,nextEnd),
						index: logIndex,
						id: log.id,
						lastValue: log.lastValue,
						position: (log.position?log.position:aggregations[aggregationIndex].position)
					});
				});
				return Promise.all(p.map(r=>r.promise)).then(results=>{
					//this.log('got all logs');
					var allLogsComplete = true;
					while(allLogsComplete && end <= nextEnd){
						results.forEach((result, i) => {
							var logItems = this.parseLog(result);
							var logComplete = false;
							logItems.forEach((logItem, itemIndex) => {
								if(logItem.date >= end){
									logComplete = true;
								}
							});
							if(!logComplete){
								allLogsComplete = false;
							}
						});
						if(!allLogsComplete){
							if(nextEnd < new Date()){
								if(nextEnd == this.addPeriodNextLog(end, aggregation.period)){
									//first time not complete
									this.log("first time missing logs for "+aggregations[aggregationIndex].name);
									Homey.ManagerApi.realtime('aggregateLog', "first time missing logs for "+aggregations[aggregationIndex].name);
	
									let notUptodateTrigger = new Homey.FlowCardTrigger('not_uptodate');
									notUptodateTrigger.register().trigger({'name': aggregations[aggregationIndex].name}).catch( this.error ).then();
								}
								if(this.addPeriod(nextEnd, aggregation.period) < new Date()){
									aggregations[aggregationIndex].nextEnd = this.addPeriod(nextEnd, aggregation.period);
									this.log("added period to "+nextEnd);
								}else{
									aggregations[aggregationIndex].nextEnd = this.addPeriodNextLog(nextEnd, aggregation.period);
									this.log("added nextlog period to " + nextEnd);
								}
								Homey.ManagerSettings.set('aggregations', aggregations);
							}
						}else{
							var logValue = null;
							if(aggregation.method.toLowerCase() == 'sum'){
								logValue = 0;
								results.forEach((result, i) => {
									this.parseLog(result).forEach(logItem => {
										if(logItem.date >= start && logItem.date < end){
											logValue += logItem.value;
											aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
										}
									});
								});
							}else if(aggregation.method.toLowerCase() == 'min'){
								results.forEach((result, i) => {
									this.parseLog(result).forEach(logItem => {
										if(logItem.date >= start && logItem.date < end && (logValue === null || logItem.value < logValue)){
											logValue = logItem.value;
											aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
										}
									});
								});
							}else if(aggregation.method.toLowerCase() == 'max'){
								results.forEach((result, i) => {
									this.parseLog(result).forEach(logItem => {
										if(logItem.date >= start && logItem.date < end && (logValue === null || logItem.value > logValue)){
											logValue = logItem.value;
											aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
										}
									});
								});
							}else if(aggregation.method.toLowerCase() == 'avarage'){
								logValue = 0;
								results.forEach((result, i) => {
									var logItems = this.parseLog(result);
									if(p[i].position.toLowerCase() == 'start'){
										if(p[i].lastValue){
											if(logItems.length == 0){
												logValue += p[i].lastValue * (end.valueOf() - start.valueOf());
											}else if(logItems[0].date > start){
												if(logItems[0].date >= end){
													logValue += p[i].lastValue * (end.valueOf() - start.valueOf());
												}else{
													logValue += p[i].lastValue * (logItems[0].date.valueOf() - start.valueOf());
												}
											}
										}
										logItems.forEach((logItem, itemIndex) => {
											if(logItem.date >= start && logItem.date < end){
												if(itemIndex == logItems.length-1 || logItems[itemIndex+1].date >= end){
													// last item
													logValue += logItem.value * (end.valueOf() - logItem.date.valueOf());
												}else{
													logValue += logItem.value * (logItems[itemIndex+1].date.valueOf() - logItem.date.valueOf());
												}
												aggregations[aggregationIndex].logs[i].lastValue = logItem.value;
											}
										});
									}else if(p[i].position.toLowerCase() == 'end'){
										logItems.forEach((logItem, itemIndex) => {
											if(itemIndex == 0){
												if(logItem.date >= end){
													logValue += logItem.value * (end.valueOf()-start.valueOf());
												}else{
													logValue += logItem.value * (logItem.date.valueOf()-start.valueOf());
												}
											}else{
												if(logItem.date >= end){
													logValue += logItem.value * (end.valueOf() - logItems[itemIndex-1].date.valueOf()) ;
												}else{
													logValue += logItem.value * (logItem.date.valueOf() - logItems[itemIndex-1].date.valueOf());
												}
											}
										});
									}
								});
								logValue /= results.length;
								logValue /= (end.valueOf() - start.valueOf());
							}else if(aggregation.method.toLowerCase() == 'difference'){
								logValue = 0;
								results.forEach((result, i) => {
									var logItems = this.parseLog(result);
									var endItemIndex = -1;
									logItems.forEach((logItem, itemIndex) => {
										if(logItem.date >= start && logItem.date < end){
											endItemIndex = itemIndex;
										}
									});

									if(endItemIndex >= 0){
										if(!isNaN(p[i].lastValue)){
											logValue += logItems[endItemIndex].value-p[i].lastValue;
										}

										aggregations[aggregationIndex].logs[i].lastValue = logItems[endItemIndex].value;
									}
								});
							}else if(aggregation.method.toLowerCase() == 'median'){
								var values = [];
								results.forEach((result, i) => {
									var logItems = this.parseLog(result);
									logItems.forEach((logItem, itemIndex) => {
										if(logItem.date >= start && logItem.date < end){
											values.push(logItem.value);
										}
									});
								});
								if(values.length > 0){
									values.sort(function(a, b){return a-b});
									if(values.length % 2 == 0){
										logValue = (values[(values.length/2)-1] + values[(values.length/2)])/2;
									}else{
										logValue = values[(((values.length+1)/2)-1)];
									}
								}else{
									logValue = 0;
								}
							}
							if(logValue !== null){
								var logDate = start;
								if(aggregation.position.toLowerCase() == 'start'){
									logDate = start;
								}else if(aggregation.position.toLowerCase() == 'middle'){
									logDate = new Date((start.valueOf()+end.valueOf())/2);
								}else if(aggregation.position.toLowerCase() == 'end'){
									logDate = end;
								}
								this.log(aggregation.name+" log value:"+logValue+" "+logDate);
								Homey.ManagerApi.realtime('aggregateLog', aggregation.name+" log value:"+logValue+" "+logDate);
								Homey.ManagerInsights.getLog(aggregation.name, function(err, logs) {
									if (err !== null) {
										Homey.ManagerInsights.createLog(
											aggregation.name, {
											label: {
												en: aggregation.label
											},
											type: 'number',
											decimals: aggregation.decimals,
											units: aggregation.units
										}, function callback(err, logs) {
											if (err) {
												console.error(err);
											}else{
												logs.createEntry( logValue, logDate, function(err, success) {
													if (err) console.error(err);
												});
											}
										});
									}else{
										logs.createEntry( logValue, logDate, function(err, success) {
											if (err) console.error(err);
										});
									}
								});
								let newAggregationTrigger = new Homey.FlowCardTrigger('new_aggregation_value');
								let tokens = {
									'name': aggregation.name,
									'value': logValue,
									'uptodate' : (this.addPeriodNextLog(this.addPeriod(end, aggregation.period), aggregation.period) > new Date())
								};
								newAggregationTrigger.register().trigger(tokens).catch( this.error ).then();
							}

							start = end;
							end = this.addPeriod(start, aggregation.period);
							aggregations[aggregationIndex].next = start;
							if(nextEnd > end){
								aggregations[aggregationIndex].nextEnd = nextEnd;
							}else{
								if(this.addPeriod(end, aggregation.period) < new Date()){
									aggregations[aggregationIndex].nextEnd = this.addPeriod(end, aggregation.period);
								}else{
									aggregations[aggregationIndex].nextEnd = this.addPeriodNextLog(end, aggregation.period);
								}
							}
							Homey.ManagerSettings.set('aggregations', aggregations);
						}
					}
				});
			}else{
				//this.log("skip " + aggregation.name+" next "+new Date(aggregation.next));
			}
			return new Promise((resolve, reject) => {
				resolve();
			});
		  })).then(result => {
			var timeout = null;
			var timeoutlog = null;
			aggregations.forEach(aggregation => {
				var aggtimeout = null;
				if(aggregation.nextEnd < new Date()){
					aggtimeout = 100;
				}else {
					aggtimeout = (new Date(aggregation.nextEnd)).valueOf()- (new Date()).valueOf();
				}
				if(timeout === null || timeout > aggtimeout){
					timeout = aggtimeout;
					timeoutlog = aggregation.name;
				}
			});
			if(timeout!==null){
				this.log("timeout "+ (timeout/60000) +" minutes for "+timeoutlog);
				Homey.ManagerApi.realtime('aggregateLog',"wait "+ Math.round(timeout/60000) +" minutes checking for "+timeoutlog);
				var t = this;
				this.timer = setTimeout(function(){t.calculateAggregations();}, timeout);
				this.calculating = false;
			}else{
				this.log("no aggregation to calculate");
				Homey.ManagerApi.realtime('aggregateLog',"no aggregation to calculate");
			}
		  }).catch(err => {
			  console.error(err);
			  Homey.ManagerApi.realtime('aggregateLog',"error during calculating aggregation retrying in 1 minute");
			  var t = this;
			  this.timer = setTimeout(function(){t.calculateAggregations();}, 60000);
			  this.calculating = false;
		  });
	  }

	  addPeriod(date, periodName){
		var newDate = new Date(date);
		if(periodName.toLowerCase() == 'hour'){
			newDate.setHours(newDate.getHours() + 1);
		}else if(periodName.toLowerCase() == 'day'){
			newDate.setDate(newDate.getDate() + 1);
		}else if(periodName.toLowerCase() == 'week'){
			newDate.setDate(newDate.getDate() + 7);
		}else if(periodName.toLowerCase() == 'month'){
			newDate.setMonth(newDate.getMonth() + 1);
		}else if(periodName.toLowerCase() == 'year'){
			newDate.setFullYear(newDate.getFullYear() + 1);
		}
		if(periodName.toLowerCase() != 'hour'){
			//compensate for summertime
			if(newDate.getHours() >= 22){
				newDate.setDate(newDate.getDate() + 1);
				newDate.setHours(0);
			}else{
				newDate.setHours(0);
			}
		}
		return newDate;
	  }

	  addPeriodNextLog(date, periodName){
		var newDate = new Date(date);
		if(periodName.toLowerCase() == 'hour'){
			newDate.setMinutes(newDate.getMinutes() + 5);
		}else if(periodName.toLowerCase() == 'day'){
			newDate.setHours(newDate.getHours() + 1);
		}else if(periodName.toLowerCase() == 'week'){
			newDate.setHours(newDate.getHours() + 12);
		}else if(periodName.toLowerCase() == 'month'){
			newDate.setDate(newDate.getDate() + 1);
		}else if(periodName.toLowerCase() == 'year'){
			newDate.setDate(newDate.getDate() + 7);
		}else{
			newDate.setMinutes(newDate.getMinutes() + 5);
		}
		return newDate;
	  }

	  getPeriodStart(date, periodName){
		var oldDate = new Date(date);
		if(periodName.toLowerCase() == 'hour'){
			return new Date(oldDate.getFullYear(), oldDate.getMonth(), oldDate.getDate(), oldDate.getHours(), 0, 0, 0);
		}
		if(periodName.toLowerCase() == 'day'){
			return new Date(oldDate.getFullYear(), oldDate.getMonth(), oldDate.getDate(), 0, 0, 0, 0);
		}
		if(periodName.toLowerCase() == 'week'){
			return new Date(oldDate.getFullYear(), oldDate.getMonth(), oldDate.getDate() - oldDate.getDay(), 0, 0, 0, 0);
		}
		if(periodName.toLowerCase() == 'month'){
			return new Date(oldDate.getFullYear(), oldDate.getMonth(), 1, 0, 0, 0, 0);
		}
		if(periodName.toLowerCase() == 'year'){
			return new Date(oldDate.getFullYear(), 1, 1, 0, 0, 0, 0);
		}
		return oldDate;
	  }

	  getAggregations(){
		var aggregations = Homey.ManagerSettings.get('aggregations');
		if(!aggregations){
			aggregations = [];
		}
		return aggregations;
	  }
}

module.exports = AggregatedInsightsApp;