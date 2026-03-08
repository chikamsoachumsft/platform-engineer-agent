// Azure Functions infrastructure
// Template variables: {{appName}}, {{region}}, {{sku}}, {{language}}

@description('Application name')
param appName string = '{{appName}}'

@description('Azure region')
param location string = '{{region}}'

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

// ── Storage Account (required for Functions) ────────────────────────

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: take('st${replace(appName, '-', '')}', 24)
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}

// ── App Service Plan ────────────────────────────────────────────────

var isConsumption = contains('{{sku}}', 'Y1') || contains('{{sku}}', 'Consumption')

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${appName}'
  location: location
  tags: tags
  sku: {
    name: isConsumption ? 'Y1' : 'EP1'
    tier: isConsumption ? 'Dynamic' : 'ElasticPremium'
  }
  properties: {
    reserved: true // Linux
  }
}

// ── Function App ────────────────────────────────────────────────────

var runtimeStack = {
  typescript: 'node'
  javascript: 'node'
  python: 'python'
  csharp: 'dotnet-isolated'
  java: 'java'
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: 'func-${appName}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${monitoring.outputs.managedIdentityId}': {}
    }
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: '${runtimeStack.?{{language}} ?? 'node'}|20'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: runtimeStack.?{{language}} ?? 'node' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: monitoring.outputs.appInsightsConnectionString }
      ]
      minTlsVersion: '1.2'
    }
  }
}

// ── Outputs ─────────────────────────────────────────────────────────

output functionAppName string = functionApp.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
