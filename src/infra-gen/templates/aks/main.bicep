// Azure Kubernetes Service (AKS) infrastructure
// Template variables: {{appName}}, {{region}}, {{sku}}

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

// ── Container Registry ──────────────────────────────────────────────

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: take('acr${replace(appName, '-', '')}', 50)
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

// ── AKS Cluster ─────────────────────────────────────────────────────

resource aksCluster 'Microsoft.ContainerService/managedClusters@2024-02-01' = {
  name: 'aks-${appName}'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    dnsPrefix: appName
    kubernetesVersion: '1.29'
    networkProfile: {
      networkPlugin: 'azure'
      networkPolicy: 'calico'
    }
    agentPoolProfiles: [
      {
        name: 'system'
        count: 2
        vmSize: '{{sku}}'
        mode: 'System'
        osType: 'Linux'
        osSKU: 'AzureLinux'
        enableAutoScaling: true
        minCount: 1
        maxCount: 5
      }
    ]
    addonProfiles: {
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceID: monitoring.outputs.logAnalyticsId
        }
      }
    }
  }
}

// ── RBAC: AKS → ACR pull ────────────────────────────────────────────

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, aksCluster.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: aksCluster.properties.identityProfile.kubeletidentity.objectId
    principalType: 'ServicePrincipal'
  }
}

// ── Outputs ─────────────────────────────────────────────────────────

output aksClusterName string = aksCluster.name
output aksClusterFqdn string = aksCluster.properties.fqdn
output acrLoginServer string = acr.properties.loginServer
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
