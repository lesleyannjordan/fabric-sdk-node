/**
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

const channel_util = require('../lib/channel');
const chaincode_util = require('../lib/chaincode');
const CCP = require('../lib/common_connection');
const testUtil = require('../lib/utils');

const path = require('path');
const fs = require('fs-extra');

const cryptoRoot = '../../../fixtures/crypto-material';
const configRoot = '../../config';
const channelRoot = cryptoRoot + '/channel-config';
const ccpPath = configRoot + '/ccp.json';
const tlsCcpPath = configRoot + '/ccp-tls.json';
const policiesPath = configRoot + '/policies.json';

const instantiatedChaincodesOnChannels = new Map();
const installedChaincodesOnPeers = new Map();
const Client = require('fabric-client');

module.exports = function () {
	this.Given(/^I put a log message (.+?)$/, {timeout: testUtil.TIMEOUTS.SHORT_STEP}, async (message) => {

		testUtil.logMsg('\n\n\n**********************************************************************************');
		testUtil.logMsg('**********************************************************************************');
		testUtil.logMsg(`****** ${message} ******`);
		testUtil.logMsg('**********************************************************************************');
		testUtil.logMsg('**********************************************************************************\n\n\n');

	});


	this.Given(/^I create all channels from the (.+?) common connection profile$/, {timeout: testUtil.TIMEOUTS.SHORT_STEP}, async (tlsType) => {

		let profile;
		let tls;

		if (tlsType.localeCompare('non-tls') === 0) {
			tls = false;
			profile =  new CCP(path.join(__dirname, ccpPath), true);
		} else {
			profile =  new CCP(path.join(__dirname, tlsCcpPath), true);
			tls = true;
		}

		try {
			for (const channelName in profile.getChannels()) {
				// Create
				await channel_util.create_channel(path.join(__dirname, channelRoot), profile, tls, channelName);
			}
			return Promise.resolve();
		} catch (err) {
			return Promise.reject(err);
		}

	});

	this.Given(/^I update channel with name (.+?) with config file (.+?) from the (.+?) common connection profile/, {timeout: testUtil.TIMEOUTS.SHORT_STEP}, async (channelName, txFileName, tlsType) => {
		if (tlsType.localeCompare('non-tls') === 0) {
			const profile =  new CCP(path.join(__dirname, ccpPath), true);
			return channel_util.update_channel(profile, channelName, path.join(channelRoot, txFileName), false);
		} else {
			const profile =  new CCP(path.join(__dirname, tlsCcpPath), true);
			return channel_util.update_channel(profile, channelName, path.join(channelRoot, txFileName), true);
		}
	}),

	this.Then(/^I can join organization (.+?) to the (.+?) enabled channel named (.+?)$/, {timeout: testUtil.TIMEOUTS.SHORT_STEP}, async (orgName, tlsType, channelName) => {
		if (tlsType.localeCompare('non-tls') === 0) {
			const profile =  new CCP(path.join(__dirname, ccpPath), true);
			return channel_util.join_channel(profile, false, channelName, orgName);
		} else {
			const profile =  new CCP(path.join(__dirname, tlsCcpPath), true);
			return channel_util.join_channel(profile, true, channelName, orgName);
		}
	});

	this.Given(/^I create and join all channels from the (.+?) common connection profile$/, {timeout: testUtil.TIMEOUTS.MED_STEP}, async (tlsType) => {
		let tls;
		let profile;

		if (tlsType.localeCompare('non-tls') === 0) {
			tls = false;
			profile = new CCP(path.join(__dirname, ccpPath), true);
		} else {
			tls = true;
			profile = new CCP(path.join(__dirname, tlsCcpPath), true);
		}

		try {
			const channels = profile.getChannels();
			for (const channelName in channels) {
				// Create
				await channel_util.create_channel(path.join(__dirname, cryptoRoot), profile, tls, channelName);

				// Join
				const channel = profile.getChannel(channelName);
				const orgs = profile.getOrganizations();
				for (const orgName in orgs) {
					const org = profile.getOrganization(orgName);
					const orgPeers = org.peers;
					if (Object.keys(channel.peers).some((peerName) => orgPeers.includes(peerName))) {
						await channel_util.join_channel(profile, tls, channelName, orgName);
					}
				}
			}
			return Promise.resolve();
		} catch (err) {
			return Promise.reject(err);
		}
	});

	this.Given(/^I have created and joined all channels from the (.+?) common connection profile$/, {timeout: testUtil.TIMEOUTS.MED_STEP}, async (tlsType) => {
		let tls;
		let profile;

		if (tlsType.localeCompare('non-tls') === 0) {
			tls = false;
			profile = new CCP(path.join(__dirname, ccpPath), true);
		} else {
			tls = true;
			profile = new CCP(path.join(__dirname, tlsCcpPath), true);
		}

		try {
			// Determine which channels should be created/joint
			const jointChannels = await channel_util.existing_channels(profile, tls);
			const ccpChannels = profile.getChannels();
			const channels = [];
			for (const channelName in ccpChannels) {
				if (jointChannels.indexOf(channelName) === -1) {
					testUtil.logMsg(`Adding channel ${channelName} to list of channels to be created`);
					channels.push(channelName);
				}
			}

			// Create and join any channels identified
			for (const channelName of channels) {
				// Create
				await channel_util.create_channel(path.join(__dirname, channelRoot), profile, tls, channelName);

				// Join all orgs to the channel
				const channel = profile.getChannel(channelName);
				const orgs = profile.getOrganizations();
				for (const orgName in orgs) {
					const org = profile.getOrganization(orgName);
					const orgPeers = org.peers;
					if (Object.keys(channel.peers).some((peerName) => orgPeers.includes(peerName))) {
						await channel_util.join_channel(profile, tls, channelName, orgName);
					}
				}
			}
			return Promise.resolve();
		} catch (err) {
			return Promise.reject(err);
		}
	});

	this.Given(/^I install (.+?) chaincode at version (.+?) named (.+?) to the (.+?) Fabric network as organization (.+?) on channel (.+?)$/, {timeout: testUtil.TIMEOUTS.SHORT_STEP}, async (ccType, version, ccName, tlsType, orgName, channelName) => {
		let profile;
		let tls;
		if (tlsType.localeCompare('non-tls') === 0) {
			tls = false;
			profile = new CCP(path.join(__dirname, ccpPath), true);
		} else {
			tls = true;
			profile =  new CCP(path.join(__dirname, tlsCcpPath), true);
		}
		if (!installedChaincodesOnPeers.has(orgName)) {
			installedChaincodesOnPeers.set(orgName, []);
		}
		if (!installedChaincodesOnPeers.get(orgName).includes(`${ccName}${version}${ccType}`)) {
			await chaincode_util.installChaincode(ccName, ccName, ccType, version, tls, profile, orgName, channelName);
			installedChaincodesOnPeers.set(orgName, [...installedChaincodesOnPeers.get(orgName), `${ccName}${version}${ccType}`]);
		}
		return true;
	});

	this.Given(/^I install (.+?) chaincode named (.+?) to the (.+?) Fabric network$/, {timeout: testUtil.TIMEOUTS.SHORT_STEP}, async (ccType, ccName, tlsType) => {
		let profile;
		let tls;
		if (tlsType.localeCompare('non-tls') === 0) {
			tls = false;
			profile = new CCP(path.join(__dirname, ccpPath), true);
		} else {
			tls = true;
			profile = new CCP(path.join(__dirname, tlsCcpPath), true);
		}

		// use first org in ccp
		const orgName = profile.getOrganizations()[0];

		// use first channel in ccp
		const channelName = profile.getChannels()[0];

		// fixed version
		const version = '1.0.0';

		if (!installedChaincodesOnPeers.has(orgName)) {
			installedChaincodesOnPeers.set(orgName, []);
		}
		if (!installedChaincodesOnPeers.get(orgName).includes(`${ccName}${version}${ccType}`)) {
			await chaincode_util.installChaincode(ccName, ccName, ccType, version, tls, profile, orgName, channelName);
			installedChaincodesOnPeers.set(orgName, [installedChaincodesOnPeers.get(orgName), `${ccName}${version}${ccType}`]);
		}
		return true;
	});

	this.Given(/^I install (.+?) chaincode named (.+?) as (.+?) to the (.+?) Fabric network$/, {timeout: testUtil.TIMEOUTS.SHORT_STEP}, async (ccType, ccName, ccId, tlsType) => {
		let profile;
		let tls;
		if (tlsType.localeCompare('non-tls') === 0) {
			tls = false;
			profile = new CCP(path.join(__dirname, ccpPath), true);
		} else {
			tls = true;
			profile = new CCP(path.join(__dirname, tlsCcpPath), true);
		}

		// use first org in ccp
		const orgName = profile.getOrganizations()[0];

		// use first channel in ccp
		const channelName = profile.getChannels()[0];

		// fixed version
		const version = '1.0.0';

		if (!installedChaincodesOnPeers.has(orgName)) {
			installedChaincodesOnPeers.set(orgName, []);
		}
		if (!installedChaincodesOnPeers.get(orgName).includes(`${ccName}${version}${ccType}`)) {
			await chaincode_util.installChaincode(ccName, ccId, ccType, version, tls, profile, orgName, channelName);
			installedChaincodesOnPeers.set(orgName, [...installedChaincodesOnPeers.get(orgName), `${ccName}${version}${ccType}`]);
		}
		return true;
	});

	this.Then(/^I can instantiate the (.+?) installed (.+?) chaincode at version (.+?) named (.+?) on the (.+?) Fabric network as organization (.+?) on channel (.+?) with endorsement policy (.+?) and args (.+?)$/, {timeout: testUtil.TIMEOUTS.LONG_STEP}, async (exisiting, ccType, version, ccName, tlsType, orgName, channelName, policyType, args) => {
		let profile;
		let tls;
		let upgrade;
		if (tlsType.localeCompare('non-tls') === 0) {
			tls = false;
			profile = new CCP(path.join(__dirname, ccpPath), true);
		} else {
			tls = true;
			profile = new CCP(path.join(__dirname, tlsCcpPath), true);
		}

		if (exisiting.localeCompare('newly') === 0) {
			upgrade = false;
		} else {
			upgrade = true;
		}

		const policy = require(path.join(__dirname, policiesPath))[policyType];
		if (!instantiatedChaincodesOnChannels.has(channelName)) {
			instantiatedChaincodesOnChannels.set(channelName, []);
		}
		if (!instantiatedChaincodesOnChannels.get(channelName).includes(`${ccName}${version}${ccType}`)) {
			await chaincode_util.instantiateChaincode(ccName, ccName, ccType, args, version, upgrade, tls, profile, orgName, channelName, policy);
			instantiatedChaincodesOnChannels.set(channelName, [...instantiatedChaincodesOnChannels.get(channelName), `${ccName}${version}${ccType}`]);
		}
		return true;
	});

	this.Then(/^I can instantiate the (.+?) installed (.+?) chaincode at version (.+?) named (.+?) with identifier (.+?) on the (.+?) Fabric network as organization (.+?) on channel (.+?) with endorsement policy (.+?) and args (.+?)$/, {timeout: testUtil.TIMEOUTS.LONG_STEP}, async (exisiting, ccType, version, ccName, ccId, tlsType, orgName, channelName, policyType, args) => {
		let profile;
		let tls;
		let upgrade;
		if (tlsType.localeCompare('non-tls') === 0) {
			tls = false;
			profile = new CCP(path.join(__dirname, ccpPath), true);
		} else {
			tls = true;
			profile = new CCP(path.join(__dirname, tlsCcpPath), true);
		}

		if (exisiting.localeCompare('newly') === 0) {
			upgrade = false;
		} else {
			upgrade = true;
		}

		const policy = require(path.join(__dirname, policiesPath))[policyType];
		if (!instantiatedChaincodesOnChannels.has(channelName)) {
			instantiatedChaincodesOnChannels.set(channelName, []);
		}
		if (!instantiatedChaincodesOnChannels.get(channelName).includes(`${ccName}${version}${ccType}`)) {
			await chaincode_util.instantiateChaincode(ccName, ccId, ccType, args, version, upgrade, tls, profile, orgName, channelName, policy);
			instantiatedChaincodesOnChannels.set(channelName, [...instantiatedChaincodesOnChannels.get(channelName), `${ccName}${version}${ccType}`]);
		}
		return true;
	});

	this.Given(/^I install\/instantiate (.+?) chaincode named (.+?) at version (.+?) as (.+?) to the (.+?) Fabric network for all organizations on channel (.+?) with endorsement policy (.+?) and args (.+?)$/, {timeout: testUtil.TIMEOUTS.LONG_STEP}, async (ccType, ccName, version, ccId, tlsType, channelName, policyType, args) => {
		let profile;
		let tls;
		if (tlsType.localeCompare('non-tls') === 0) {
			tls = false;
			profile = new CCP(path.join(__dirname, ccpPath), true);
		} else {
			tls = true;
			profile = new CCP(path.join(__dirname, tlsCcpPath), true);
		}
		const policy = require(path.join(__dirname, policiesPath))[policyType];

		const orgs = profile.getOrganizationsForChannel(channelName);

		try {
			for (const org in orgs) {
				const orgName = orgs[org];
				if (!installedChaincodesOnPeers.has(orgName)) {
					installedChaincodesOnPeers.set(orgName, []);
				}
				if (!installedChaincodesOnPeers.get(orgName).includes(`${ccName}${version}${ccType}`)) {
					await chaincode_util.installChaincode(ccName, ccId, ccType, version, tls, profile, orgName, channelName);
					installedChaincodesOnPeers.set(orgName, [...installedChaincodesOnPeers.get(orgName), `${ccName}${version}${ccType}`]);
				}
			}

			if (!instantiatedChaincodesOnChannels.has(channelName)) {
				instantiatedChaincodesOnChannels.set(channelName, []);
			}
			if (!instantiatedChaincodesOnChannels.get(channelName).includes(`${ccName}${version}${ccType}`)) {
				await chaincode_util.instantiateChaincode(ccName, ccId, ccType, args, version, false, tls, profile, orgs[0], channelName, policy);
				instantiatedChaincodesOnChannels.set(channelName, [...instantiatedChaincodesOnChannels.get(channelName), `${ccName}${version}${ccType}`]);
			}
			return true;
		} catch (err) {
			testUtil.logError('Install/Instantiate failed with error: ', err);
			throw err;
		}

	});

	this.Given(/^I force install\/instantiate (.+?) chaincode named (.+?) at version (.+?) as (.+?) to the (.+?) Fabric network for all organizations on channel (.+?) with endorsement policy (.+?) and args (.+?)$/, {timeout: testUtil.TIMEOUTS.LONG_STEP}, async (ccType, ccName, version, ccId, tlsType, channelName, policyType, args) => {
		let profile;
		let tls;
		if (tlsType.localeCompare('non-tls') === 0) {
			tls = false;
			profile = new CCP(path.join(__dirname, ccpPath), true);
		} else {
			tls = true;
			profile = new CCP(path.join(__dirname, tlsCcpPath), true);
		}
		const policy = require(path.join(__dirname, policiesPath))[policyType];

		const orgs = profile.getOrganizationsForChannel(channelName);

		try {
			for (const org in orgs) {
				const orgName = orgs[org];
				await chaincode_util.installChaincode(ccName, ccId, ccType, version, tls, profile, orgName, channelName);
			}
			await chaincode_util.instantiateChaincode(ccName, ccId, ccType, args, version, false, tls, profile, orgs[0], channelName, policy);

			return true;
		} catch (err) {
			testUtil.logError('Force Install/Instantiate failed with error: ', err);
			throw err;
		}

	});

	this.Then(/^I can create and join a version_two capabilities channel named (.+?) to two organizations$/, {timeout: testUtil.TIMEOUTS.LONG_STEP}, async (channel_name) => {
		const client_org1  = Client.getConfigSetting('client-org1').value;
		const client_org2  = Client.getConfigSetting('client-org2').value;
		const peer_org1    = Client.getConfigSetting('peer-org1').value;
		const peer_org2    = Client.getConfigSetting('peer-org2').value;
		const orderer_org1 = Client.getConfigSetting('orderer-org1').value;
		const orderer_org2 = Client.getConfigSetting('orderer-org2').value;

		const channel_path = path.join(__dirname, '../../../fixtures/crypto-material/config-v2/' + channel_name + '.tx');
		await testUtil.createUpdateChannel(true, channel_path, channel_name, client_org1, client_org2, orderer_org1, orderer_org2);

		const channel_org1 = await testUtil.joinChannel(channel_name, peer_org1, orderer_org1, client_org1);
		const channel_org2 = await testUtil.joinChannel(channel_name, peer_org2, orderer_org2, client_org2);

		Client.setConfigSetting('channel-org1-' + channel_name, {value: channel_org1});
		Client.setConfigSetting('channel-org2-' + channel_name, {value: channel_org2});
	});

	this.Given(/^I have created fabric-client network instances/, {timeout: testUtil.TIMEOUTS.LONG_STEP}, async () => {
		const network_ccp = path.join(__dirname, '../../../fixtures/profiles/network-ad.yaml');
		const org1_ccp = path.join(__dirname, '../../../fixtures/profiles/org1.yaml');
		const org2_ccp = path.join(__dirname, '../../../fixtures/profiles/org2.yaml');

		const client_org1 = await testUtil.getClientForOrg(network_ccp, org1_ccp);
		const client_org2 = await testUtil.getClientForOrg(network_ccp, org2_ccp);

		let data = fs.readFileSync(path.join(__dirname, '../../../fixtures/crypto-material/crypto-config/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/msp/tlscacerts/tlsca.org1.example.com-cert.pem'));
		let pem = Buffer.from(data).toString();
		const peer_org1 = client_org1.newPeer('grpcs://localhost:7051', {pem: pem, 'ssl-target-name-override': 'peer0.org1.example.com', name: 'peer0.org1.example.com'});

		data = fs.readFileSync(path.join(__dirname, '../../../fixtures/crypto-material/crypto-config/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/msp/tlscacerts/tlsca.org2.example.com-cert.pem'));
		pem = Buffer.from(data).toString();
		const peer_org2 = client_org2.newPeer('grpcs://localhost:8051', {pem: pem, 'ssl-target-name-override': 'peer0.org2.example.com', name: 'peer0.org2.example.com'});

		data = fs.readFileSync(path.join(__dirname, '../../../fixtures/crypto-material/crypto-config/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem'));
		pem = Buffer.from(data).toString();
		const orderer_org1 = client_org1.newOrderer('grpcs://localhost:7050', {pem: pem, 'ssl-target-name-override': 'orderer.example.com', name: 'orderer.example.com'});
		const orderer_org2 = client_org2.newOrderer('grpcs://localhost:7050', {pem: pem, 'ssl-target-name-override': 'orderer.example.com', name: 'orderer.example.com'});

		Client.setConfigSetting('client-org1', {value: client_org1});
		Client.setConfigSetting('client-org2', {value: client_org2});
		Client.setConfigSetting('peer-org1', {value: peer_org1});
		Client.setConfigSetting('peer-org2', {value: peer_org2});
		Client.setConfigSetting('orderer-org1', {value: orderer_org1});
		Client.setConfigSetting('orderer-org2', {value: orderer_org2});
	});

};
