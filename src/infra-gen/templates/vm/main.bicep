// Azure Virtual Machine infrastructure
// Template variables: {{appName}}, {{region}}, {{sku}}, {{port}}

@description('Application name')
param appName string = '{{appName}}'

@description('Azure region')
param location string = '{{region}}'

@secure()
param adminPublicKey string

param tags object = {
  app: appName
  managedBy: 'platform-engineer-agent'
}

// ── Monitoring (shared module) ──────────────────────────────────────

module monitoring '../common/main.bicep' = {
  name: 'monitoring'
  params: {
    appName: appName
    location: location
    tags: tags
  }
}

// ── Virtual Network ─────────────────────────────────────────────────

resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: 'vnet-${appName}'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: ['10.0.0.0/16']
    }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: '10.0.1.0/24'
        }
      }
    ]
  }
}

// ── Network Security Group ──────────────────────────────────────────

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-01-01' = {
  name: 'nsg-${appName}'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowHTTPS'
        properties: {
          priority: 100
          protocol: 'Tcp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
      {
        name: 'AllowHTTP'
        properties: {
          priority: 110
          protocol: 'Tcp'
          access: 'Allow'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '{{port}}'
        }
      }
      {
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          protocol: '*'
          access: 'Deny'
          direction: 'Inbound'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

// ── Public IP ───────────────────────────────────────────────────────

resource publicIp 'Microsoft.Network/publicIPAddresses@2024-01-01' = {
  name: 'pip-${appName}'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
  }
}

// ── Network Interface ───────────────────────────────────────────────

resource nic 'Microsoft.Network/networkInterfaces@2024-01-01' = {
  name: 'nic-${appName}'
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: {
            id: vnet.properties.subnets[0].id
          }
          publicIPAddress: {
            id: publicIp.id
          }
        }
      }
    ]
    networkSecurityGroup: {
      id: nsg.id
    }
  }
}

// ── Virtual Machine ─────────────────────────────────────────────────

resource vm 'Microsoft.Compute/virtualMachines@2024-03-01' = {
  name: 'vm-${appName}'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${monitoring.outputs.managedIdentityId}': {}
    }
  }
  properties: {
    hardwareProfile: {
      vmSize: '{{sku}}'
    }
    osProfile: {
      computerName: take(appName, 15)
      adminUsername: 'azureuser'
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/azureuser/.ssh/authorized_keys'
              keyData: adminPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-jammy'
        sku: '22_04-lts-gen2'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'Premium_LRS'
        }
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
        }
      ]
    }
  }
}

// ── Outputs ─────────────────────────────────────────────────────────

output vmName string = vm.name
output publicIpAddress string = publicIp.properties.ipAddress
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
